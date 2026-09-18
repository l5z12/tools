// SPDX-License-Identifier: AGPL-3.0-only
use crate::{
    classical::{letters, normalized, square},
    workbench::option,
};
use serde_json::Value;

struct HillMatrix {
    entries: [i64; 4],
    inverse_determinant: i64,
}

impl HillMatrix {
    fn parse(text: &str) -> Result<Self, String> {
        let entries = text
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|entry| !entry.is_empty())
            .map(|entry| entry.parse::<i64>().map(|n| n.rem_euclid(26)))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| "Matrix entries must be integers.")?;
        let entries: [i64; 4] = entries
            .try_into()
            .map_err(|_| "Enter four entries: a b c d, in row order.")?;
        let [a, b, c, d] = entries;
        let determinant = (a * d - b * c).rem_euclid(26);
        let inverse_determinant = (0..26)
            .find(|candidate| (determinant * candidate) % 26 == 1)
            .ok_or("Matrix determinant must be coprime to 26.")?;
        Ok(Self {
            entries,
            inverse_determinant,
        })
    }

    fn for_operation(&self, decrypt: bool) -> [i64; 4] {
        if !decrypt {
            return self.entries;
        }
        let [a, b, c, d] = self.entries;
        [d, -b, -c, a].map(|entry| entry * self.inverse_determinant)
    }
}

fn pad_pairs(mut letters: Vec<u8>, decrypt: bool) -> Result<Vec<u8>, String> {
    if letters.len() % 2 != 0 {
        if decrypt {
            return Err("Ciphertext needs an even letter count.".into());
        }
        letters.push(b'X' - b'A');
    }
    Ok(letters)
}

pub(super) fn hill(input: &str, options: &Value, decrypt: bool) -> Result<String, String> {
    let matrix = HillMatrix::parse(option(options, "matrix", "3 3 2 5"))?;
    let [a, b, c, d] = matrix.for_operation(decrypt);
    let input = pad_pairs(letters(input), decrypt)?;
    let mut output = String::with_capacity(input.len());
    for pair in input.chunks_exact(2) {
        let x = pair[0] as i64;
        let y = pair[1] as i64;
        output.push(((a * x + b * y).rem_euclid(26) as u8 + b'A') as char);
        output.push(((c * x + d * y).rem_euclid(26) as u8 + b'A') as char);
    }
    Ok(output)
}

pub(super) fn four_square(input: &str, options: &Value, decrypt: bool) -> Result<String, String> {
    let plain_square = square("");
    let top_right = square(option(options, "key", "EXAMPLE"));
    let bottom_left = square(option(options, "key2", "KEYWORD"));
    let input = pad_pairs(normalized(input), decrypt)?;
    let (first_source, second_source, first_target, second_target) = if decrypt {
        (&top_right, &bottom_left, &plain_square, &plain_square)
    } else {
        (&plain_square, &plain_square, &top_right, &bottom_left)
    };

    let mut output = String::with_capacity(input.len());
    for pair in input.chunks_exact(2) {
        // Normalization guarantees membership in every 25-letter square.
        let first = first_source
            .iter()
            .position(|&letter| letter == pair[0])
            .unwrap();
        let second = second_source
            .iter()
            .position(|&letter| letter == pair[1])
            .unwrap();
        let first_corner = first / 5 * 5 + second % 5;
        let second_corner = second / 5 * 5 + first % 5;
        output.push((first_target[first_corner] + b'A') as char);
        output.push((second_target[second_corner] + b'A') as char);
    }
    Ok(output)
}
