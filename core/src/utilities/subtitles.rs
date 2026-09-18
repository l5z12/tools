// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, file, option};
use regex::Regex;
use serde_json::{json, Value};

fn milliseconds(timestamp: &str) -> Result<i64, String> {
    let fields: Vec<_> = timestamp.split([':', '.', ',']).collect();
    if fields.len() != 3 && fields.len() != 4 {
        return Err("Invalid subtitle timestamp.".into());
    }
    let parse = |field: &str| {
        field
            .parse::<i64>()
            .map_err(|_| "Invalid timestamp digits.")
    };
    let (hours, minutes, seconds, millis) = if fields.len() == 4 {
        (
            parse(fields[0])?,
            parse(fields[1])?,
            parse(fields[2])?,
            parse(fields[3])?,
        )
    } else {
        (0, parse(fields[0])?, parse(fields[1])?, parse(fields[2])?)
    };
    if minutes >= 60 || seconds >= 60 {
        return Err("Timestamp minutes and seconds must be below 60.".into());
    }
    Ok(((hours * 60 + minutes) * 60 + seconds) * 1000 + millis)
}

fn timestamp(milliseconds: i64, vtt: bool) -> String {
    let separator = if vtt { '.' } else { ',' };
    format!(
        "{:02}:{:02}:{:02}{separator}{:03}",
        milliseconds / 3_600_000,
        milliseconds / 60_000 % 60,
        milliseconds / 1000 % 60,
        milliseconds % 1000
    )
}

pub(super) fn shift(input: &str, options: &Value) -> Result<Value, String> {
    let offset = option(options, "shift", "0")
        .parse::<i64>()
        .map_err(|_| "Shift must be an integer number of milliseconds.")?;
    if offset.unsigned_abs() > 604_800_000 {
        return Err("Shift is limited to plus or minus seven days.".into());
    }
    let normalized = input.replace("\r\n", "\n").replace('\r', "\n");
    let vtt = normalized.lines().next().is_some_and(|line| {
        line == "WEBVTT" || line.starts_with("WEBVTT ") || line.starts_with("WEBVTT\t")
    });
    let timing = Regex::new(r"^((?:\d{2,6}:)?\d{2}:\d{2}[.,]\d{3})[ \t]+-->[ \t]+((?:\d{2,6}:)?\d{2}:\d{2}[.,]\d{3})(.*)$").unwrap();
    let inline_timestamp = Regex::new(r"<\d{2}(?::\d{2})?:\d{2}\.\d{3}>").unwrap();
    let mut blocks = Vec::new();
    let mut count = 0;
    let mut first_start: Option<i64> = None;
    let mut last_end = 0;
    for (block_index, block) in normalized
        .split("\n\n")
        .map(|block| block.trim_matches('\n'))
        .filter(|block| !block.trim().is_empty())
        .enumerate()
    {
        if vtt && block_index == 0 {
            if block.lines().count() != 1 {
                return Err("WebVTT needs a blank line after its header; metadata headers are not supported.".into());
            }
            blocks.push(block.to_string());
            continue;
        }
        let mut lines: Vec<String> = block.lines().map(str::to_string).collect();
        if lines.first().is_some_and(|line| {
            ["NOTE", "STYLE", "REGION"]
                .iter()
                .any(|prefix| line == prefix || line.starts_with(&format!("{prefix} ")))
        }) {
            return Err(
                "NOTE, STYLE and REGION blocks are not supported by this timing shifter.".into(),
            );
        }
        let timing_index = if lines.first().is_some_and(|line| line.contains("-->")) {
            0
        } else {
            1
        };
        let captures = lines
            .get(timing_index)
            .and_then(|line| timing.captures(line))
            .ok_or("Every subtitle block must have a valid cue timing line.")?;
        if lines.len() <= timing_index + 1 {
            return Err("A subtitle cue must have text.".into());
        }
        if !vtt
            && (!captures[1].contains(',')
                || captures[1].matches(':').count() != 2
                || !captures[2].contains(',')
                || captures[2].matches(':').count() != 2)
        {
            return Err("SRT timestamps must use HH:MM:SS,mmm.".into());
        }
        if vtt && (captures[1].contains(',') || captures[2].contains(',')) {
            return Err("WebVTT timestamps must use a decimal point.".into());
        }
        let settings = captures[3].to_string();
        if !vtt && !settings.trim().is_empty() {
            return Err("SRT timing suffixes are not supported.".into());
        }
        if !settings.is_empty() && !settings.starts_with([' ', '\t']) {
            return Err("Cue settings must be separated by whitespace.".into());
        }
        let start = milliseconds(&captures[1])?;
        let end = milliseconds(&captures[2])?;
        if end <= start {
            return Err("Each cue must end after it starts.".into());
        }
        let shifted_start = start + offset;
        let shifted_end = end + offset;
        if shifted_start < 0 {
            return Err(
                "The shift would move a cue before zero; choose a smaller negative shift.".into(),
            );
        }
        if lines[timing_index + 1..]
            .iter()
            .any(|line| inline_timestamp.is_match(line))
        {
            return Err("Inline WebVTT timestamp tags are not supported.".into());
        }
        lines[timing_index] = format!(
            "{} --> {}{settings}",
            timestamp(shifted_start, vtt),
            timestamp(shifted_end, vtt)
        );
        first_start = Some(first_start.map_or(shifted_start, |current| current.min(shifted_start)));
        last_end = last_end.max(shifted_end);
        blocks.push(lines.join("\n"));
        count += 1;
        crate::limits::check(count, 10_000, "Subtitles are limited to 10,000 cues.")?;
    }
    if count == 0 {
        return Err("No subtitle cues found.".into());
    }
    let text = blocks.join("\n\n") + "\n";
    let mut result = code(text.clone(), "text");
    result["data"] = json!({"format": if vtt { "WebVTT" } else { "SRT" }, "cues": count, "shiftMs": offset, "firstStartMs": first_start, "lastEndMs": last_end});
    result["files"] = json!([file(
        if vtt { "shifted.vtt" } else { "shifted.srt" },
        if vtt {
            "text/vtt"
        } else {
            "application/x-subrip"
        },
        text.as_bytes()
    )]);
    Ok(result)
}
