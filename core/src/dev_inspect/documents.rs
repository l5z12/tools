// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, option, table};
use serde_json::{json, Value};

pub fn source_map(bytes: &[u8], options: &Value) -> Result<Value, String> {
    let line = option(options, "line", "1")
        .parse::<u32>()
        .map_err(|_| "Line must be a positive integer.")?;
    let column = option(options, "column", "0")
        .parse::<u32>()
        .map_err(|_| "Column must be a nonnegative integer.")?;
    if line == 0 {
        return Err("Lines start at 1; columns start at 0.".into());
    }
    let map = match sourcemap::decode_slice(bytes).map_err(|e| e.to_string())? {
        sourcemap::DecodedMap::Regular(map) => map,
        sourcemap::DecodedMap::Index(index) => index.flatten().map_err(|e| e.to_string())?,
        _ => return Err("Use a regular v3 source map or an index with embedded sections.".into()),
    };
    let Some(token) = map.lookup_token(line - 1, column) else {
        return Ok(data(json!({ "mapped": false })));
    };
    if !token.has_source() || token.get_dst_line() != line - 1 {
        return Ok(data(json!({ "mapped": false })));
    }
    let snippet = token
        .get_source_view()
        .and_then(|view| view.get_line(token.get_src_line()))
        .map(|line| line.chars().take(2000).collect::<String>());
    Ok(data(json!({
        "mapped": true, "source": token.get_source(), "name": token.get_name(),
        "originalLine": token.get_src_line() as u64 + 1,
        "originalColumn": token.get_src_col(), "sourceLinePreview": snippet,
    })))
}

#[derive(Default)]
struct PatchFile {
    header: String,
    old_path: Option<String>,
    new_path: Option<String>,
    added: u64,
    removed: u64,
    hunks: u64,
    binary: bool,
    metadata: Vec<String>,
}
impl PatchFile {
    fn row(self) -> Value {
        json!({
            "fileHeader": self.header, "oldPath": self.old_path, "newPath": self.new_path,
            "addedLines": self.added, "removedLines": self.removed,
            "hunks": self.hunks, "binary": self.binary, "metadata": self.metadata,
        })
    }
}
pub fn git_patch(text: &str) -> Result<Value, String> {
    let hunk = regex::Regex::new(r"^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@").unwrap();
    let mut rows = Vec::new();
    let mut current: Option<PatchFile> = None;
    let mut old_remaining = 0u64;
    let mut new_remaining = 0u64;
    for (index, line) in text.lines().enumerate() {
        if old_remaining > 0 || new_remaining > 0 {
            let file = current.as_mut().ok_or("Hunk without a file header.")?;
            match line.as_bytes().first() {
                Some(b'+') if new_remaining > 0 => {
                    new_remaining -= 1;
                    file.added += 1;
                }
                Some(b'-') if old_remaining > 0 => {
                    old_remaining -= 1;
                    file.removed += 1;
                }
                Some(b' ') if old_remaining > 0 && new_remaining > 0 => {
                    old_remaining -= 1;
                    new_remaining -= 1;
                }
                Some(b'\\') => {}
                _ => {
                    return Err(format!(
                        "Malformed or truncated hunk at line {}.",
                        index + 1
                    ))
                }
            }
            continue;
        }
        if let Some(header) = line.strip_prefix("diff --git ") {
            if let Some(file) = current.take() {
                rows.push(file.row());
            }
            if rows.len() >= 10_000 {
                return Err("Use at most 10,000 files in a patch.".into());
            }
            current = Some(PatchFile {
                header: header.to_string(),
                ..Default::default()
            });
            continue;
        }
        let Some(file) = current.as_mut() else {
            continue;
        };
        if line.starts_with("@@@") {
            return Err("Combined merge diffs are not supported; use a two-way Git diff.".into());
        }
        if let Some(captures) = hunk.captures(line) {
            let count = |index| {
                captures.get(index).map_or(Ok(1), |m| {
                    m.as_str()
                        .parse::<u64>()
                        .map_err(|_| "Invalid hunk length.")
                })
            };
            old_remaining = count(1)?;
            new_remaining = count(2)?;
            file.hunks += 1;
        } else if line.starts_with("@@") {
            return Err("Invalid hunk header.".into());
        } else if let Some(path) = line.strip_prefix("--- ") {
            file.old_path = Some(path.to_string());
        } else if let Some(path) = line.strip_prefix("+++ ") {
            file.new_path = Some(path.to_string());
        } else if line.starts_with("Binary files ") || line == "GIT binary patch" {
            file.binary = true;
        } else if [
            "rename from ",
            "rename to ",
            "old mode ",
            "new mode ",
            "new file mode ",
            "deleted file mode ",
            "similarity index ",
            "copy from ",
            "copy to ",
        ]
        .iter()
        .any(|prefix| line.starts_with(prefix))
        {
            file.metadata.push(line.to_string());
        }
    }
    if old_remaining > 0 || new_remaining > 0 {
        return Err("Patch ends before the hunk is complete.".into());
    }
    if let Some(file) = current {
        rows.push(file.row());
    }
    if rows.is_empty() {
        return Err("Expected Git diff text beginning with diff --git headers.".into());
    }
    Ok(table(rows))
}
