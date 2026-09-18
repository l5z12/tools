// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    classical::number,
    codecs::{bytes_result, parse_bytes},
    workbench::option,
};
use rc4::{consts::*, KeyInit, Rc4, StreamCipher};
use serde_json::Value;

pub(super) fn run(input: &str, options: &Value, decrypt: bool) -> Result<Value, String> {
    let key = parse_bytes(option(options, "key", ""), "Hex")?;
    let mut bytes = parse_bytes(input, option(options, "inputFormat", "UTF-8"))?;
    let discard_count = number(options, "drop", "0", 0, 1_000_000)? as usize;

    // RustCrypto expresses key length at the type level. Keep dispatch local
    // while the cryptographic primitive remains entirely in the library.
    macro_rules! apply_rc4 {
        ($key_size:ty) => {{
            let mut cipher =
                Rc4::<$key_size>::new_from_slice(&key).map_err(|_| "Invalid RC4 key length.")?;
            let mut discarded = vec![0; discard_count];
            cipher.apply_keystream(&mut discarded);
            cipher.apply_keystream(&mut bytes);
        }};
    }
    match key.len() {
        3 => apply_rc4!(U3),
        4 => apply_rc4!(U4),
        5 => apply_rc4!(U5),
        6 => apply_rc4!(U6),
        8 => apply_rc4!(U8),
        16 => apply_rc4!(U16),
        24 => apply_rc4!(U24),
        32 => apply_rc4!(U32),
        _ => return Err("RC4 accepts 3, 4, 5, 6, 8, 16, 24 or 32 key bytes in this tool.".into()),
    }
    let mut result = bytes_result(&bytes);
    if !decrypt {
        result["text"] = Value::String(hex::encode(bytes));
    }
    Ok(result)
}
