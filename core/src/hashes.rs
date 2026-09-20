// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    codecs::{parse_bytes, parse_hex},
    workbench::{code, file, option},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::Digest;
use std::io::Cursor;

const ALGORITHMS: &str = include_str!("../../src/lib/hash-algorithms.json");

fn shake<D>(input: &[u8], length: usize) -> Vec<u8>
where
    D: Default + sha3::digest::Update + sha3::digest::ExtendableOutput,
{
    use sha3::digest::XofReader;
    let mut hasher = D::default();
    hasher.update(input);
    let mut output = vec![0; length];
    hasher.finalize_xof().read(&mut output);
    output
}

fn adler32(input: &[u8]) -> u32 {
    let (mut first, mut second) = (1u32, 0u32);
    for &byte in input {
        first = (first + byte as u32) % 65521;
        second = (second + first) % 65521;
    }
    second << 16 | first
}

fn fnv32(input: &[u8]) -> u32 {
    input.iter().fold(0x811c9dc5u32, |hash, &byte| {
        (hash ^ byte as u32).wrapping_mul(0x01000193)
    })
}

fn fnv64(input: &[u8]) -> u64 {
    input.iter().fold(0xcbf29ce484222325u64, |hash, &byte| {
        (hash ^ byte as u64).wrapping_mul(0x100000001b3)
    })
}

fn digest(algorithm: &str, input: &[u8], length: usize, seed: u64) -> Result<Vec<u8>, String> {
    use sha3::digest::consts::{U16, U32, U48};
    let seed32 = || {
        u32::try_from(seed).map_err(|_| "This algorithm needs a seed from 0 through 4294967295.")
    };
    let result = match algorithm {
        "SHA-224" => sha2::Sha224::digest(input).to_vec(),
        "SHA-256" => sha2::Sha256::digest(input).to_vec(),
        "SHA-384" => sha2::Sha384::digest(input).to_vec(),
        "SHA-512" => sha2::Sha512::digest(input).to_vec(),
        "SHA-512/224" => sha2::Sha512_224::digest(input).to_vec(),
        "SHA-512/256" => sha2::Sha512_256::digest(input).to_vec(),
        "SHA3-224" => sha3::Sha3_224::digest(input).to_vec(),
        "SHA3-256" => sha3::Sha3_256::digest(input).to_vec(),
        "SHA3-384" => sha3::Sha3_384::digest(input).to_vec(),
        "SHA3-512" => sha3::Sha3_512::digest(input).to_vec(),
        "Keccak-224" => sha3::Keccak224::digest(input).to_vec(),
        "Keccak-256" => sha3::Keccak256::digest(input).to_vec(),
        "Keccak-384" => sha3::Keccak384::digest(input).to_vec(),
        "Keccak-512" => sha3::Keccak512::digest(input).to_vec(),
        "SHAKE128" => shake::<sha3::Shake128>(input, length),
        "SHAKE256" => shake::<sha3::Shake256>(input, length),
        "BLAKE2b-256" => blake2::Blake2b::<U32>::digest(input).to_vec(),
        "BLAKE2b-384" => blake2::Blake2b::<U48>::digest(input).to_vec(),
        "BLAKE2b-512" => blake2::Blake2b512::digest(input).to_vec(),
        "BLAKE2s-128" => blake2::Blake2s::<U16>::digest(input).to_vec(),
        "BLAKE2s-256" => blake2::Blake2s256::digest(input).to_vec(),
        "BLAKE3" => blake3::hash(input).as_bytes().to_vec(),
        "BLAKE3 XOF" => {
            let mut hasher = blake3::Hasher::new();
            hasher.update(input);
            let mut output = vec![0; length];
            hasher.finalize_xof().fill(&mut output);
            output
        }
        "SM3" => sm3::Sm3::digest(input).to_vec(),
        "Streebog-256" => <streebog::Streebog256 as streebog::Digest>::digest(input).to_vec(),
        "Streebog-512" => <streebog::Streebog512 as streebog::Digest>::digest(input).to_vec(),
        "MD2" => <md2::Md2 as md2::Digest>::digest(input).to_vec(),
        "MD4" => md4::Md4::digest(input).to_vec(),
        "MD5" => <md5::Md5 as md5::Digest>::digest(input).to_vec(),
        "SHA-1" => sha1::Sha1::digest(input).to_vec(),
        "RIPEMD-128" => ripemd::Ripemd128::digest(input).to_vec(),
        "RIPEMD-160" => ripemd::Ripemd160::digest(input).to_vec(),
        "RIPEMD-256" => ripemd::Ripemd256::digest(input).to_vec(),
        "RIPEMD-320" => ripemd::Ripemd320::digest(input).to_vec(),
        "Whirlpool" => whirlpool::Whirlpool::digest(input).to_vec(),
        "GOST94 CryptoPro" => gost94::Gost94CryptoPro::digest(input).to_vec(),
        "GOST94 Test" => gost94::Gost94Test::digest(input).to_vec(),
        "Tiger" => tiger::Tiger::digest(input).to_vec(),
        "Tiger2" => tiger::Tiger2::digest(input).to_vec(),
        "CRC-32/ISO-HDLC" => crc32fast::hash(input).to_be_bytes().to_vec(),
        "CRC-32C" => crc32c::crc32c(input).to_be_bytes().to_vec(),
        "Adler-32" => adler32(input).to_be_bytes().to_vec(),
        "FNV-1a-32" => fnv32(input).to_be_bytes().to_vec(),
        "FNV-1a-64" => fnv64(input).to_be_bytes().to_vec(),
        "xxHash32" => xxhash_rust::xxh32::xxh32(input, seed32()?)
            .to_be_bytes()
            .to_vec(),
        "xxHash64" => xxhash_rust::xxh64::xxh64(input, seed)
            .to_be_bytes()
            .to_vec(),
        "XXH3-64" => xxhash_rust::xxh3::xxh3_64_with_seed(input, seed)
            .to_be_bytes()
            .to_vec(),
        "XXH3-128" => xxhash_rust::xxh3::xxh3_128_with_seed(input, seed)
            .to_be_bytes()
            .to_vec(),
        "Murmur3 x86-32" => murmur3::murmur3_32(&mut Cursor::new(input), seed32()?)
            .map_err(|error| error.to_string())?
            .to_be_bytes()
            .to_vec(),
        "Murmur3 x64-128" => murmur3::murmur3_x64_128(&mut Cursor::new(input), seed32()?)
            .map_err(|error| error.to_string())?
            .to_be_bytes()
            .to_vec(),
        _ => return Err("Unknown hash algorithm.".into()),
    };
    Ok(result)
}

fn select_algorithms<'a>(
    definitions: &'a [Value],
    options: &Value,
) -> Result<Vec<&'a Value>, String> {
    let names = if let Some(selection) = options.get("algorithms") {
        let entries = selection
            .as_array()
            .ok_or("Algorithms must be a list of names.")?;
        if entries.is_empty() || entries.len() > definitions.len() {
            return Err(format!(
                "Choose between 1 and {} hash variants.",
                definitions.len()
            ));
        }
        entries
            .iter()
            .map(|entry| entry.as_str().ok_or("Each algorithm must be a name."))
            .collect::<Result<Vec<_>, _>>()?
    } else {
        // Retain the original single/all API for existing callers.
        let algorithm = option(options, "algorithm", "SHA-256");
        if algorithm == "All algorithms" {
            return Ok(definitions.iter().collect());
        }
        vec![algorithm]
    };
    for name in &names {
        if !definitions
            .iter()
            .any(|definition| definition["name"] == *name)
        {
            return Err(format!("Unknown hash algorithm: {name}"));
        }
    }
    // Catalog order keeps reports stable and naturally removes duplicate selections.
    Ok(definitions
        .iter()
        .filter(|definition| names.iter().any(|name| definition["name"] == *name))
        .collect())
}

pub fn execute(input: &str, source: &[u8], options: &Value) -> Result<Value, String> {
    let definitions: Vec<Value> =
        serde_json::from_str(ALGORITHMS).map_err(|error| error.to_string())?;
    let selected = select_algorithms(&definitions, options)?;
    let bytes = if options["fileProvided"] == true {
        source.to_vec()
    } else {
        parse_bytes(input, option(options, "inputFormat", "UTF-8"))?
    };
    if selected.len() > 1 {
        crate::limits::check(
            bytes.len(),
            1024 * 1024,
            "Multiple-hash calculation is limited to 1 MiB; choose a single algorithm for larger files.",
        )?;
    }
    if selected
        .iter()
        .any(|definition| definition["name"] == "MD2")
    {
        crate::limits::check(bytes.len(), 4 * 1024 * 1024, "MD2 is limited to 4 MiB.")?;
    }
    let length = option(options, "length", "32")
        .parse::<usize>()
        .map_err(|_| "Output length must be an integer.")?;
    if !(1..=4096).contains(&length) {
        return Err("XOF length must be between 1 and 4096 bytes.".into());
    }
    let seed = option(options, "seed", "0")
        .parse::<u64>()
        .map_err(|_| "Seed must be an unsigned 64-bit decimal integer.")?;
    let expected = option(options, "expected", "");
    let expected = if expected.trim().is_empty() {
        None
    } else {
        Some(parse_hex(expected)?)
    };
    let mut rows = Vec::new();
    let mut single_digest = None;
    for definition in selected {
        let name = definition["name"].as_str().unwrap();
        let output = digest(name, &bytes, length, seed)?;
        rows.push(json!({
            "algorithm": name,
            "category": definition["category"],
            "bits": output.len() * 8,
            "hex": hex::encode(&output),
            "matchesExpected": expected.as_ref().map(|value| value == &output)
        }));
        single_digest = Some(output);
    }
    if rows.len() == 1 {
        let output = single_digest.unwrap();
        let mut result = code(hex::encode(&output), "text");
        result["data"] = rows.remove(0);
        result["data"]["inputBytes"] = json!(bytes.len());
        result["formatBytes"] = json!(STANDARD.encode(&output));
        result["files"] = json!([
            file("digest.txt", "text/plain", hex::encode(&output).as_bytes()),
            file("digest.bin", "application/octet-stream", &output)
        ]);
        return Ok(result);
    }
    let text = serde_json::to_string_pretty(&rows).map_err(|error| error.to_string())?;
    Ok(json!({
        "kind": "table",
        "rows": rows,
        "data": {"inputBytes": bytes.len(), "algorithms": rows.len()},
        "text": text,
        "files": [file("hashes.json", "application/json", text.as_bytes())]
    }))
}
