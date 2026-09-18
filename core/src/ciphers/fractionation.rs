// SPDX-License-Identifier: AGPL-3.0-only
use super::keyed_alphabet;
use crate::{
    classical::{key, normalized, number, square, transpose},
    workbench::option,
};
use serde_json::Value;

fn column_order(keyword: &str) -> Result<Vec<usize>, String> {
    let letters = key(keyword)?;
    crate::limits::check(
        letters.len(),
        1000,
        "Transposition keyword is limited to 1000 letters.",
    )?;
    let mut columns: Vec<_> = (0..letters.len()).collect();
    columns.sort_by_key(|&index| letters[index]);
    Ok(columns)
}

pub(super) fn adfgx(
    input: &str,
    options: &Value,
    decrypt: bool,
    include_digits: bool,
) -> Result<String, String> {
    let keyword = option(options, "key", "");
    let coordinates = if include_digits {
        b"ADFGVX".as_slice()
    } else {
        b"ADFGX".as_slice()
    };
    let width = coordinates.len();
    let square = if include_digits {
        keyed_alphabet(keyword, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    } else {
        square(keyword).iter().map(|letter| letter + b'A').collect()
    };
    let columns = column_order(option(options, "transposition", "CARGO"))?;

    if decrypt {
        let compact = input
            .split_whitespace()
            .collect::<String>()
            .to_ascii_uppercase();
        if compact.len() % 2 != 0 || !compact.bytes().all(|symbol| coordinates.contains(&symbol)) {
            return Err(
                "Ciphertext must contain complete pairs from the coordinate alphabet.".into(),
            );
        }
        let restored = transpose(&compact, &columns, true);
        let mut output = String::with_capacity(restored.len() / 2);
        for pair in restored.as_bytes().chunks_exact(2) {
            let row = coordinates
                .iter()
                .position(|&symbol| symbol == pair[0])
                .unwrap();
            let column = coordinates
                .iter()
                .position(|&symbol| symbol == pair[1])
                .unwrap();
            output.push(square[row * width + column] as char);
        }
        return Ok(output);
    }

    let symbols: Vec<u8> = if include_digits {
        input
            .bytes()
            .filter(u8::is_ascii_alphanumeric)
            .map(|letter| letter.to_ascii_uppercase())
            .collect()
    } else {
        normalized(input)
            .iter()
            .map(|letter| letter + b'A')
            .collect()
    };
    let mut fractionated = String::with_capacity(symbols.len() * 2);
    for symbol in symbols {
        let position = square.iter().position(|&letter| letter == symbol).unwrap();
        fractionated.push(coordinates[position / width] as char);
        fractionated.push(coordinates[position % width] as char);
    }
    Ok(transpose(&fractionated, &columns, false))
}

fn trifid_alphabet(options: &Value) -> Result<Vec<u8>, String> {
    let alphabet = option(options, "alphabet", "ABCDEFGHIJKLMNOPQRSTUVWXYZ.").to_ascii_uppercase();
    if alphabet.len() != 27 || !alphabet.is_ascii() {
        return Err("Trifid alphabet needs 27 unique ASCII symbols.".into());
    }
    let mut unique = alphabet.as_bytes().to_vec();
    unique.sort();
    unique.dedup();
    if unique.len() != 27
        || alphabet
            .bytes()
            .any(|symbol| symbol.is_ascii_whitespace() || symbol.is_ascii_control())
    {
        return Err("Trifid alphabet needs unique visible ASCII symbols without spaces.".into());
    }
    Ok(keyed_alphabet(option(options, "key", ""), &alphabet))
}

fn trifid_block(positions: &[usize], decrypt: bool) -> Vec<usize> {
    let length = positions.len();
    let mut coordinates = Vec::with_capacity(length * 3);
    if decrypt {
        for &position in positions {
            coordinates.extend([position / 9, position / 3 % 3, position % 3]);
        }
        return (0..length)
            .map(|index| {
                coordinates[index] * 9
                    + coordinates[length + index] * 3
                    + coordinates[2 * length + index]
            })
            .collect();
    }

    // Read all layer coordinates, then rows, then columns before regrouping.
    coordinates.extend(positions.iter().map(|position| position / 9));
    coordinates.extend(positions.iter().map(|position| position / 3 % 3));
    coordinates.extend(positions.iter().map(|position| position % 3));
    coordinates
        .chunks_exact(3)
        .map(|triple| triple[0] * 9 + triple[1] * 3 + triple[2])
        .collect()
}

pub(super) fn trifid(input: &str, options: &Value, decrypt: bool) -> Result<String, String> {
    let alphabet = trifid_alphabet(options)?;
    let period = number(options, "period", "5", 1, 1000)? as usize;
    let positions = input
        .bytes()
        .filter(|symbol| !symbol.is_ascii_whitespace())
        .map(|symbol| {
            alphabet
                .iter()
                .position(|&letter| letter == symbol.to_ascii_uppercase())
                .ok_or("Input contains a symbol outside the Trifid alphabet.")
        })
        .collect::<Result<Vec<_>, _>>()?;

    let mut output = String::with_capacity(positions.len());
    for block in positions.chunks(period) {
        for position in trifid_block(block, decrypt) {
            output.push(alphabet[position] as char);
        }
    }
    Ok(output)
}

fn polybius_number(square: &[u8], letter: u8) -> i64 {
    let position = square.iter().position(|&symbol| symbol == letter).unwrap();
    ((position / 5 + 1) * 10 + position % 5 + 1) as i64
}

pub(super) fn nihilist(input: &str, options: &Value, decrypt: bool) -> Result<String, String> {
    let square = square(option(options, "key", ""));
    let additive_key = normalized(option(options, "additiveKey", "RUSSIAN"));
    if additive_key.is_empty() {
        return Err("Additive key needs letters.".into());
    }
    let shifts: Vec<_> = additive_key
        .iter()
        .map(|&letter| polybius_number(&square, letter))
        .collect();
    if !decrypt {
        return Ok(normalized(input)
            .iter()
            .enumerate()
            .map(|(index, &letter)| {
                (polybius_number(&square, letter) + shifts[index % shifts.len()]).to_string()
            })
            .collect::<Vec<_>>()
            .join(" "));
    }

    let mut output = String::new();
    for (index, token) in input.split_whitespace().enumerate() {
        let value = token
            .parse::<i64>()
            .map_err(|_| "Expected space-separated decimal numbers.")?;
        if !(22..=110).contains(&value) {
            return Err("Nihilist sums must be between 22 and 110.".into());
        }
        let coordinate = value - shifts[index % shifts.len()];
        let (row, column) = (coordinate / 10, coordinate % 10);
        if !(1..=5).contains(&row) || !(1..=5).contains(&column) {
            return Err("Invalid coordinate after subtracting the key.".into());
        }
        output.push((square[((row - 1) * 5 + column - 1) as usize] + b'A') as char);
    }
    Ok(output)
}
