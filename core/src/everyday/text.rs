// SPDX-License-Identifier: AGPL-3.0-only
use super::{csv_rows, report, setting};
use crate::workbench::{code, data, file};
use serde_json::{json, Value};
use unicode_segmentation::UnicodeSegmentation;

pub fn reading_time(input: &str, options: &Value) -> Result<Value, String> {
    let reading = setting(options, "reading", "220", 1., 10_000.)?;
    let speaking = setting(options, "speaking", "130", 1., 10_000.)?;
    let words = input.unicode_words().count();
    Ok(data(json!({
        "words": words,
        "readingSeconds": (words as f64 / reading * 60.).ceil(),
        "speakingSeconds": (words as f64 / speaking * 60.).ceil(),
        "readingWordsPerMinute": reading,
        "speakingWordsPerMinute": speaking,
    })))
}
pub fn transpose(input: &str) -> Result<Value, String> {
    let rows = csv_rows(input)?;
    if rows.len() > 1000 {
        return Err("Transpose supports at most 1,000 input rows.".into());
    }
    let mut writer = csv::Writer::from_writer(Vec::new());
    for col in 0..rows[0].len() {
        writer
            .write_record(rows.iter().map(|row| row[col].as_str()))
            .map_err(|e| e.to_string())?;
    }
    let bytes = writer.into_inner().map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    Ok(
        json!({"kind":"code","text":text,"files":[file("transposed.csv","text/csv",text.as_bytes())]}),
    )
}
pub fn checklist(input: &str) -> Result<Value, String> {
    let mut rows = Vec::new();
    let mut section = "";
    let mut completed = 0;
    let mut fence: Option<(char, usize)> = None;
    for (index, line) in input.lines().enumerate() {
        let line = line.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            let marker = line.chars().next().unwrap();
            let length = line.chars().take_while(|ch| *ch == marker).count();
            if let Some((open_marker, open_length)) = fence {
                if marker == open_marker
                    && length >= open_length
                    && line[length..].trim().is_empty()
                {
                    fence = None;
                }
            } else {
                fence = Some((marker, length));
            }
            continue;
        }
        if fence.is_some() {
            continue;
        }
        if line.starts_with('#') {
            section = line.trim_start_matches('#').trim();
            continue;
        }
        let Some(item) = line
            .strip_prefix("- ")
            .or_else(|| line.strip_prefix("* "))
            .or_else(|| line.strip_prefix("+ "))
        else {
            continue;
        };
        let (done, task) = if let Some(task) = item.strip_prefix("[ ] ") {
            (false, task)
        } else if let Some(task) = item
            .strip_prefix("[x] ")
            .or_else(|| item.strip_prefix("[X] "))
        {
            (true, task)
        } else {
            continue;
        };
        completed += usize::from(done);
        rows.push(json!({"task":task,"completed":done,"section":section,"line":index+1}));
        if rows.len() > 10_000 {
            return Err("Use at most 10,000 checklist items.".into());
        }
    }
    let count = rows.len();
    let percent = if count == 0 {
        0.
    } else {
        100. * completed as f64 / count as f64
    };
    let summary = json!({
        "total": count,
        "completed": completed,
        "remaining": count - completed,
        "percentComplete": percent,
    });
    Ok(report(rows, summary))
}
pub fn wrap(input: &str, options: &Value) -> Result<Value, String> {
    let width = setting(options, "width", "80", 10., 500.)?;
    if width.fract() != 0. {
        return Err("Line width must be a whole number.".into());
    }
    let mut output = String::new();
    for (index, line) in input.lines().enumerate() {
        if index > 0 {
            output.push('\n');
        }
        let mut column = 0;
        for word in line.split_whitespace() {
            let length = word.graphemes(true).count();
            if column > 0 {
                if column + 1 + length > width as usize {
                    output.push('\n');
                    column = 0;
                } else {
                    output.push(' ');
                    column += 1;
                }
            }
            output.push_str(word);
            column += length;
        }
    }
    if input.ends_with('\n') {
        output.push('\n');
    }
    Ok(code(output, "text"))
}
