// SPDX-License-Identifier: AGPL-3.0-only
use crate::classical::{key, letters, mapped, number};
use serde_json::Value;

fn shift_letters(input: &str, decrypt: bool, mut shift_at: impl FnMut(usize) -> i64) -> String {
    let mut letter_index = 0;
    mapped(input, |letter| {
        let shift = shift_at(letter_index);
        letter_index += 1;
        if decrypt {
            letter - shift
        } else {
            letter + shift
        }
    })
}

pub(super) fn gronsfeld(input: &str, keyword: &str, decrypt: bool) -> Result<String, String> {
    if keyword.is_empty() || !keyword.bytes().all(|c| c.is_ascii_digit()) {
        return Err("Gronsfeld key must contain decimal digits.".into());
    }
    let shifts: Vec<u8> = keyword.bytes().map(|c| c - b'0').collect();
    Ok(shift_letters(input, decrypt, |index| {
        shifts[index % shifts.len()] as i64
    }))
}

pub(super) fn running_key(input: &str, keyword: &str, decrypt: bool) -> Result<String, String> {
    let shifts = key(keyword)?;
    if shifts.len() < letters(input).len() {
        return Err("Running key needs one letter per input letter; it does not repeat.".into());
    }
    Ok(shift_letters(input, decrypt, |index| shifts[index] as i64))
}

pub(super) fn trithemius(input: &str, options: &Value, decrypt: bool) -> Result<String, String> {
    let start = number(options, "start", "0", -1_000_000, 1_000_000)?;
    let step = number(options, "step", "1", -1000, 1000)?;
    Ok(shift_letters(input, decrypt, |index| {
        start + step * index as i64
    }))
}
