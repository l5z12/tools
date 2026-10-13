// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    codecs::{bytes_result, parse_bytes},
    workbench::{code, file, option},
};
use aes_gcm::{
    aead::{Aead, Payload},
    KeyInit,
};
use serde_json::{json, Value};
use sha2::Sha256;

// Use the RustCrypto implementations; no custom cryptographic primitives.
fn transform(
    id: &str,
    key: &[u8],
    iv: &[u8],
    aad: &[u8],
    input: &[u8],
    decrypt: bool,
) -> Result<Vec<u8>, String> {
    macro_rules! aead {
        ($ty:ty) => {{
            let cipher = <$ty>::new_from_slice(key).map_err(|_| "Invalid key length.")?;
            let payload = Payload { msg: input, aad };
            if decrypt {
                cipher.decrypt(iv.into(), payload)
            } else {
                cipher.encrypt(iv.into(), payload)
            }
            .map_err(|_| "Authentication failed: check key, nonce, AAD and ciphertext.".to_string())
        }};
    }
    macro_rules! ctr {
        ($ty:ty) => {{
            use ctr::cipher::{KeyIvInit, StreamCipher};
            let mut cipher = ctr::Ctr128BE::<$ty>::new_from_slices(key, iv)
                .map_err(|_| "Invalid key or counter length.")?;
            let mut out = input.to_vec();
            cipher
                .try_apply_keystream(&mut out)
                .map_err(|_| "Counter exhausted.")?;
            Ok(out)
        }};
    }
    match id {
        "crypto-aes-gcm" => match key.len() {
            16 => aead!(aes_gcm::Aes128Gcm),
            // aes-gcm 0.10 requires its own compatible AES version.
            24 => aead!(aes_gcm::AesGcm<aes_gcm::aes::Aes192,aes_gcm::aead::consts::U12>),
            32 => aead!(aes_gcm::Aes256Gcm),
            _ => Err("AES key must be 16, 24 or 32 bytes.".into()),
        },
        "crypto-chacha20-poly1305" => aead!(chacha20poly1305::ChaCha20Poly1305),
        "crypto-xchacha20-poly1305" => aead!(chacha20poly1305::XChaCha20Poly1305),
        "crypto-aes-cbc" => match key.len() {
            16 => transform_cbc::<aes::Aes128>(key, iv, input, decrypt),
            24 => transform_cbc::<aes::Aes192>(key, iv, input, decrypt),
            32 => transform_cbc::<aes::Aes256>(key, iv, input, decrypt),
            _ => Err("AES key must be 16, 24 or 32 bytes.".into()),
        },
        "crypto-aes-ctr" => match key.len() {
            16 => ctr!(aes::Aes128),
            24 => ctr!(aes::Aes192),
            32 => ctr!(aes::Aes256),
            _ => Err("AES key must be 16, 24 or 32 bytes.".into()),
        },
        "crypto-des-cbc" => transform_cbc::<des::Des>(key, iv, input, decrypt),
        "crypto-3des-cbc" => transform_cbc::<des::TdesEde3>(key, iv, input, decrypt),
        "crypto-blowfish-cbc" => transform_cbc::<blowfish::Blowfish>(key, iv, input, decrypt),
        "crypto-twofish-cbc" => transform_cbc::<twofish::Twofish>(key, iv, input, decrypt),
        "crypto-serpent-cbc" => {
            if ![16, 24, 32].contains(&key.len()) {
                return Err("Serpent key must be 16, 24 or 32 bytes.".into());
            }
            transform_cbc::<serpent::Serpent>(key, iv, input, decrypt)
        }
        "crypto-camellia-cbc" => match key.len() {
            16 => transform_cbc::<camellia::Camellia128>(key, iv, input, decrypt),
            24 => transform_cbc::<camellia::Camellia192>(key, iv, input, decrypt),
            32 => transform_cbc::<camellia::Camellia256>(key, iv, input, decrypt),
            _ => Err("Camellia key must be 16, 24 or 32 bytes.".into()),
        },
        _ => Err("Unknown encryption algorithm.".into()),
    }
}

fn transform_cbc<C>(key: &[u8], iv: &[u8], input: &[u8], decrypt: bool) -> Result<Vec<u8>, String>
where
    C: cbc::cipher::BlockCipherEncrypt + cbc::cipher::BlockCipherDecrypt + cbc::cipher::KeyInit,
{
    use cbc::cipher::{
        array::Array, block_padding::Pkcs7, BlockModeDecrypt, BlockModeEncrypt, InnerIvInit,
    };
    let cipher = C::new_from_slice(key).map_err(|_| "Invalid key or IV length.")?;
    let iv = Array::<u8, C::BlockSize>::try_from(iv).map_err(|_| "Invalid key or IV length.")?;
    if decrypt {
        cbc::Decryptor::inner_iv_init(cipher, &iv)
            .decrypt_padded_vec::<Pkcs7>(input)
            .map_err(|_| "Invalid ciphertext length or PKCS#7 padding.".to_string())
    } else {
        Ok(cbc::Encryptor::inner_iv_init(cipher, &iv).encrypt_padded_vec::<Pkcs7>(input))
    }
}

fn integer(opts: &Value, key: &str, default: &str, max: usize) -> Result<usize, String> {
    let v = option(opts, key, default)
        .parse::<usize>()
        .map_err(|_| format!("{key} must be an integer."))?;
    if v == 0 || v > max {
        Err(format!("{key} must be between 1 and {max}."))
    } else {
        Ok(v)
    }
}
pub fn execute(id: &str, input: &str, source: &[u8], opts: &Value) -> Result<Value, String> {
    if id == "crypto-pbkdf2" || id == "crypto-hkdf" {
        let salt = parse_bytes(option(opts, "salt", ""), "Hex")?;
        let length = integer(opts, "length", "32", 128)?;
        let mut out = vec![0; length];
        if id == "crypto-pbkdf2" {
            if salt.is_empty() {
                return Err("Enter or generate a salt.".into());
            }
            let iterations = integer(opts, "iterations", "600000", 2_000_000)?;
            pbkdf2::pbkdf2_hmac::<Sha256>(input.as_bytes(), &salt, iterations as u32, &mut out);
        } else {
            let key = parse_bytes(input, "Hex")?;
            if key.is_empty() {
                return Err("Enter hex input key material.".into());
            }
            hkdf::Hkdf::<Sha256>::new(Some(&salt), &key)
                .expand(option(opts, "info", "").as_bytes(), &mut out)
                .map_err(|_| "Invalid HKDF output length.")?;
        }
        let mut result = bytes_result(&out);
        result["text"] = json!(hex::encode(&out));
        return Ok(result);
    }
    let decrypt = option(opts, "mode", "Encrypt") == "Decrypt";
    let key = parse_bytes(option(opts, "key", ""), "Hex")?;
    if key.is_empty() {
        return Err("Enter a key, or generate one using the button.".into());
    }
    let nonce_length = match id {
        "crypto-aes-gcm" | "crypto-chacha20-poly1305" => 12,
        "crypto-xchacha20-poly1305" => 24,
        "crypto-des-cbc" | "crypto-3des-cbc" | "crypto-blowfish-cbc" => 8,
        _ => 16,
    };
    let authenticated = matches!(
        id,
        "crypto-aes-gcm" | "crypto-chacha20-poly1305" | "crypto-xchacha20-poly1305"
    );
    let format = option(opts, "inputFormat", "UTF-8");
    let raw_text = std::str::from_utf8(source).ok();
    let envelope = if decrypt && format == "Envelope" {
        Some(
            serde_json::from_str::<Value>(raw_text.ok_or("Envelope must be UTF-8 JSON.")?)
                .map_err(|e| format!("Invalid envelope: {e}"))?,
        )
    } else if decrypt {
        raw_text
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .filter(|e| e.get("version").is_some() || e.get("algorithm").is_some())
    } else {
        None
    };
    let (iv, aad, bytes) = if let Some(e) = envelope {
        if e["version"] != 1 || e["algorithm"] != id {
            return Err("Envelope version or algorithm does not match this tool.".into());
        }
        let get = |k: &str| {
            e[k].as_str()
                .ok_or_else(|| format!("Envelope is missing {k}."))
        };
        (
            parse_bytes(get("iv")?, "Hex")?,
            parse_bytes(get("aad")?, "Hex")?,
            parse_bytes(get("ciphertext")?, "Hex")?,
        )
    } else {
        if decrypt && opts["fileProvided"] != true && !matches!(format, "Hex" | "Base64") {
            return Err(
                "Paste an encryption envelope, or select Hex/Base64 for ciphertext.".into(),
            );
        }
        let bytes = if opts["fileProvided"] == true {
            source.to_vec()
        } else {
            parse_bytes(input, format)?
        };
        (
            parse_bytes(option(opts, "iv", ""), "Hex")?,
            option(opts, "aad", "").as_bytes().to_vec(),
            bytes,
        )
    };
    if iv.len() != nonce_length {
        return Err(format!("Nonce / IV must be exactly {nonce_length} bytes."));
    }
    crate::limits::check(
        bytes.len(),
        8 * 1024 * 1024 + if decrypt { 16 } else { 0 },
        "Payload is limited to 8 MiB, plus padding or authentication tag on decryption.",
    )?;
    if !authenticated && !aad.is_empty() {
        return Err("AAD is supported only by authenticated encryption modes.".into());
    }
    let out = transform(id, &key, &iv, &aad, &bytes, decrypt)?;
    if decrypt {
        return Ok(bytes_result(&out));
    }
    let envelope = json!({"version":1,"algorithm":id,"iv":hex::encode(&iv),"aad":hex::encode(&aad),"ciphertext":hex::encode(&out)});
    let text = serde_json::to_string_pretty(&envelope).map_err(|e| e.to_string())?;
    let mut v = code(text.clone(), "json");
    v["data"] = json!({"algorithm":id,"keyBits":key.len()*8,"inputBytes":bytes.len(),"ciphertextBytes":out.len(),"iv":hex::encode(iv),"authentication":if authenticated{"128-bit tag appended to ciphertext"}else{"none"}});
    v["files"] = json!([
        file("encrypted.json", "application/json", text.as_bytes()),
        file("ciphertext.bin", "application/octet-stream", &out)
    ]);
    Ok(v)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn known_vectors() {
        let zero = vec![0; 16];
        let r = transform("crypto-aes-gcm", &zero, &[0; 12], &[], &zero, false).unwrap();
        assert_eq!(
            hex::encode(r),
            "0388dace60b6a392f328c2b971b2fe78ab6e47d42cec13bdf53a67b21257bddf"
        );
        let key = hex::decode("133457799bbcdff1").unwrap();
        let plain = hex::decode("0123456789abcdef").unwrap();
        assert_eq!(
            hex::encode(
                &transform("crypto-des-cbc", &key, &[0; 8], &[], &plain, false).unwrap()[..8]
            ),
            "85e813540f0ab405"
        );
        assert_eq!(
            hex::encode(
                &transform("crypto-twofish-cbc", &zero, &zero, &[], &zero, false).unwrap()[..16]
            ),
            "9f589f5cf6122c32b6bfec2f2ae8c35a"
        );
        assert_eq!(
            hex::encode(
                &transform("crypto-serpent-cbc", &zero, &zero, &[], &zero, false).unwrap()[..16]
            ),
            "3620b17ae6a993d09618b8768266bae9"
        );
    }
    #[test]
    fn cbc_openssl_vectors() {
        // Node/OpenSSL createCipheriv with PKCS#7 padding and the legacy provider.
        let plain = b"CBC migration regression";
        for (id, key_length, block_size, expected) in [
            (
                "des-cbc",
                8,
                8,
                "0378cca4761064c5f1b6d6c3131ee9753ea59c9b7e1b00e3e0a1622c90315d33",
            ),
            (
                "3des-cbc",
                24,
                8,
                "e49d656f86a42df0d3f9452a23ca04caafa15661a040558bafc56a34c667dda3",
            ),
            (
                "blowfish-cbc",
                16,
                8,
                "8a6e1f50661a28b747894bfdf481a9adf3defdf89bce48730af945e138552053",
            ),
            (
                "camellia-cbc",
                16,
                16,
                "48e2ab3ef995c9f863add3edd2340668aa08cce8877a68f0f9b25b41db07e5c8",
            ),
            (
                "camellia-cbc",
                24,
                16,
                "be1e12e31b0314d82318cf6c3de99f6904f0b6fedf553117d18134b41d2c6d62",
            ),
            (
                "camellia-cbc",
                32,
                16,
                "575f6c3e6ce46c59ee82413a74012be2f055f82a126a01d73719d6f9970fa89e",
            ),
        ] {
            let id = format!("crypto-{id}");
            let key: Vec<u8> = (1..=key_length).collect();
            let iv: Vec<u8> = (0..block_size).collect();
            let ciphertext = hex::decode(expected).unwrap();
            assert_eq!(
                transform(&id, &key, &iv, &[], plain, false).unwrap(),
                ciphertext,
                "{id} with {key_length}-byte key"
            );
            assert_eq!(
                transform(&id, &key, &iv, &[], &ciphertext, true).unwrap(),
                plain,
                "{id} with {key_length}-byte key"
            );
        }
    }
    #[test]
    fn cbc_rejects_invalid_input() {
        for (id, key_length, block_size) in [
            ("aes-cbc", 16, 16),
            ("des-cbc", 8, 8),
            ("3des-cbc", 24, 8),
            ("blowfish-cbc", 16, 8),
            ("twofish-cbc", 32, 16),
            ("serpent-cbc", 32, 16),
            ("camellia-cbc", 16, 16),
        ] {
            let id = format!("crypto-{id}");
            let key = vec![7; key_length];
            let iv = vec![3; block_size];
            assert!(transform(&id, &[], &iv, &[], &[], false).is_err(), "{id}");
            assert!(
                transform(&id, &key, &iv[..block_size - 1], &[], &[], false).is_err(),
                "{id}"
            );
            let ciphertext = transform(&id, &key, &iv, &[], &[], false).unwrap();
            assert_eq!(ciphertext.len(), block_size, "{id}");
            assert!(transform(&id, &key, &iv, &[], &[], true).is_err(), "{id}");
            assert!(
                transform(&id, &key, &iv, &[], &ciphertext[..block_size - 1], true).is_err(),
                "{id}"
            );
            // Empty plaintext is one padding block; force its last byte to zero.
            let mut bad_iv = iv;
            bad_iv[block_size - 1] ^= block_size as u8;
            assert!(
                transform(&id, &key, &bad_iv, &[], &ciphertext, true).is_err(),
                "{id}"
            );
        }
    }
    #[test]
    fn roundtrips_and_authentication() {
        for (id, k, n) in [
            ("aes-gcm", 16, 12),
            ("aes-gcm", 24, 12),
            ("aes-gcm", 32, 12),
            ("chacha20-poly1305", 32, 12),
            ("xchacha20-poly1305", 32, 24),
            ("aes-cbc", 16, 16),
            ("aes-cbc", 24, 16),
            ("aes-cbc", 32, 16),
            ("aes-ctr", 16, 16),
            ("aes-ctr", 24, 16),
            ("aes-ctr", 32, 16),
            ("des-cbc", 8, 8),
            ("3des-cbc", 24, 8),
            ("blowfish-cbc", 32, 8),
            ("twofish-cbc", 32, 16),
            ("serpent-cbc", 16, 16),
            ("serpent-cbc", 24, 16),
            ("serpent-cbc", 32, 16),
            ("camellia-cbc", 16, 16),
            ("camellia-cbc", 24, 16),
            ("camellia-cbc", 32, 16),
        ] {
            let id = format!("crypto-{id}");
            for plain in [vec![], vec![0], (0..=255).collect::<Vec<_>>()] {
                let mut o = json!({"key":hex::encode(vec![7;k]),"iv":hex::encode(vec![3;n]),"fileProvided":true});
                let e = execute(&id, "", &plain, &o).unwrap();
                o["mode"] = json!("Decrypt");
                o["fileProvided"] = json!(false);
                let text = e["text"].as_str().unwrap();
                let d = execute(&id, text, text.as_bytes(), &o).unwrap();
                assert_eq!(d["data"]["hex"], hex::encode(&plain));
                if n == 12 || n == 24 {
                    let mut envelope: Value = serde_json::from_str(text).unwrap();
                    envelope["aad"] = json!("00");
                    let tampered = envelope.to_string();
                    assert!(execute(&id, &tampered, tampered.as_bytes(), &o).is_err());
                }
            }
        }
    }
    #[test]
    fn kdf_vectors() {
        let p = execute(
            "crypto-pbkdf2",
            "password",
            b"password",
            &json!({"salt":"73616c74","iterations":"1"}),
        )
        .unwrap();
        assert_eq!(
            p["text"],
            "120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"
        );
        let h = execute(
            "crypto-hkdf",
            &"0b".repeat(22),
            &[],
            &json!({"salt":"000102030405060708090a0b0c","info":"","length":"42"}),
        )
        .unwrap();
        assert_eq!(h["data"]["bytes"], 42);
    }
}
