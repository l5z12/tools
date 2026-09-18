// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, file, option};
use base64::{engine::general_purpose::STANDARD, Engine};
use rand::rngs::OsRng;
use rsa::{
    pkcs8::{DecodePrivateKey, DecodePublicKey, EncodePrivateKey, EncodePublicKey, LineEnding},
    traits::PublicKeyParts,
    Oaep, RsaPrivateKey, RsaPublicKey,
};
use serde_json::{json, Value};
use sha2::Sha256;

fn rsa_payload(input: &str, opts: &Value, decrypt: bool) -> Result<Vec<u8>, String> {
    if decrypt
        && (option(opts, "inputFormat", "UTF-8") == "Envelope"
            || input.trim_start().starts_with('{'))
    {
        let value: Value = serde_json::from_str(input).map_err(|e| e.to_string())?;
        if value["version"] != 1
            || value["algorithm"] != "crypto-rsa-oaep"
            || value["hash"] != "SHA-256"
        {
            return Err("Invalid RSA-OAEP/SHA-256 envelope.".into());
        }
        return STANDARD
            .decode(value["ciphertext"].as_str().ok_or("Missing ciphertext.")?)
            .map_err(|e| e.to_string());
    }
    let format = option(opts, "inputFormat", "UTF-8");
    if decrypt && format == "UTF-8" {
        return Err("Use Hex or Base64 ciphertext.".into());
    }
    crate::codecs::parse_bytes(input, format)
}

pub(super) fn keypair() -> Result<Value, String> {
    let private = RsaPrivateKey::new(&mut OsRng, 2048).map_err(|e| e.to_string())?;
    let public = private
        .to_public_key()
        .to_public_key_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;
    let secret = private
        .to_pkcs8_pem(LineEnding::LF)
        .map_err(|e| e.to_string())?;
    let mut result = code(public.clone(), "pem");
    result["data"] = json!({
        "publicKey": public,
        "privateKey": secret.as_str(),
    });
    result["files"] = json!([
        file("public.pem", "application/x-pem-file", public.as_bytes()),
        file("private.pem", "application/x-pem-file", secret.as_bytes()),
    ]);
    Ok(result)
}

pub(super) fn execute(input: &str, opts: &Value) -> Result<Value, String> {
    let decrypt = option(opts, "mode", "Encrypt") == "Decrypt";
    let raw = option(opts, "key", "");
    if raw.len() > 32768 {
        return Err("Key exceeds 32 KiB.".into());
    }
    let payload = rsa_payload(input, opts, decrypt)?;
    if decrypt {
        let key = RsaPrivateKey::from_pkcs8_pem(raw).map_err(|e| e.to_string())?;
        if !(2048..=8192).contains(&key.n().bits()) {
            return Err("Use RSA keys from 2048 to 8192 bits.".into());
        }
        let output = key
            .decrypt_blinded(&mut OsRng, Oaep::new::<Sha256>(), &payload)
            .map_err(|_| "RSA operation failed. Check the key and ciphertext.")?;
        let mut result = code(
            String::from_utf8(output.clone())
                .unwrap_or_else(|_| "Binary result — use the file download.".into()),
            "text",
        );
        result["data"] = json!({
            "bytes": output.len(),
            "hex": hex::encode(&output),
            "base64": STANDARD.encode(&output),
        });
        result["files"] = json!([file("result.bin", "application/octet-stream", &output)]);
        Ok(result)
    } else {
        let key = RsaPublicKey::from_public_key_pem(raw).map_err(|e| e.to_string())?;
        if !(2048..=8192).contains(&key.n().bits()) {
            return Err("Use RSA keys from 2048 to 8192 bits.".into());
        }
        if payload.len() > key.size() - 66 {
            return Err(format!(
                "This key supports at most {} plaintext bytes with SHA-256.",
                key.size() - 66
            ));
        }
        let output = key
            .encrypt(&mut OsRng, Oaep::new::<Sha256>(), &payload)
            .map_err(|e| e.to_string())?;
        let envelope = serde_json::to_string_pretty(&json!({
            "version": 1,
            "algorithm": "crypto-rsa-oaep",
            "hash": "SHA-256",
            "ciphertext": STANDARD.encode(&output),
        }))
        .map_err(|e| e.to_string())?;
        let mut result = code(envelope.clone(), "json");
        result["data"] = json!({
            "algorithm": "RSA-OAEP / SHA-256",
            "keyBits": key.n().bits(),
            "inputBytes": payload.len(),
            "ciphertextBytes": output.len(),
        });
        result["files"] = json!([
            file("encrypted.json", "application/json", envelope.as_bytes()),
            file("ciphertext.bin", "application/octet-stream", &output)
        ]);
        Ok(result)
    }
}
