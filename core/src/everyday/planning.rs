// SPDX-License-Identifier: AGPL-3.0-only
use super::{csv_rows, named_csv, number, report};
use crate::workbench::{data, file, option, table};
use chrono::{Datelike, NaiveDate, NaiveDateTime, NaiveTime};
use serde_json::{json, Value};
use std::collections::BTreeSet;

fn date(input: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(input.trim(), "%Y-%m-%d")
        .map_err(|_| format!("Invalid date: {input}. Use YYYY-MM-DD."))
}
pub fn business_days(input: &str, options: &Value) -> Result<Value, String> {
    let start = date(option(options, "start", "2026-01-01"))?;
    let end = date(option(options, "end", "2026-01-31"))?;
    let count = (end - start).num_days();
    if !(0..=36600).contains(&count) {
        return Err("End must be on or after start, within 100 years.".into());
    }
    let holidays = input
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(date)
        .collect::<Result<BTreeSet<_>, _>>()?;
    let inclusive = options["inclusive"] != false;
    let mut working = 0;
    let mut weekends = 0;
    let mut excluded = 0;
    for offset in 0..count + i64::from(inclusive) {
        let current = start + chrono::Duration::days(offset);
        if current.weekday().number_from_monday() > 5 {
            weekends += 1;
        } else if holidays.contains(&current) {
            excluded += 1;
        } else {
            working += 1;
        }
    }
    Ok(data(json!({
        "businessDays": working,
        "weekendDays": weekends,
        "weekdayHolidays": excluded,
        "totalDays": working + weekends + excluded,
        "start": start.to_string(),
        "end": end.to_string(),
        "endIncluded": inclusive,
    })))
}
pub fn timesheet(input: &str) -> Result<Value, String> {
    let mut rows = Vec::new();
    let mut total = 0i64;
    for row in named_csv(input, &["date", "start", "end", "break_minutes"])? {
        let day = date(&row[0])?;
        let start = NaiveTime::parse_from_str(row[1].trim(), "%H:%M")
            .map_err(|_| "Start time must be HH:MM (24-hour).")?;
        let end = NaiveTime::parse_from_str(row[2].trim(), "%H:%M")
            .map_err(|_| "End time must be HH:MM (24-hour).")?;
        let pause = row[3]
            .trim()
            .parse::<i64>()
            .map_err(|_| "Break minutes must be a whole number.")?;
        let mut duration = (end - start).num_minutes();
        let overnight = duration < 0;
        if overnight {
            duration += 1440;
        }
        if pause < 0 || pause > duration {
            return Err("Break must be between zero and the shift length.".into());
        }
        let worked = duration - pause;
        total += worked;
        rows.push(json!({
            "date": day.to_string(),
            "start": row[1],
            "end": row[2],
            "overnight": overnight,
            "breakMinutes": pause,
            "workedMinutes": worked,
            "hours": worked as f64 / 60.,
        }));
    }
    let summary = json!({
        "totalMinutes": total,
        "hoursAndMinutes": format!("{}h {}m", total / 60, total % 60),
        "decimalHours": total as f64 / 60.,
    });
    Ok(report(rows, summary))
}
pub fn decision(input: &str, options: &Value) -> Result<Value, String> {
    let rows = csv_rows(input)?;
    if rows[0].len() < 2 || rows.len() < 2 {
        return Err("Use an option column, at least one criterion, and one data row.".into());
    }
    let weights = option(options, "weights", "1,1,1")
        .split(',')
        .map(|v| number(v, "Weight", 0., 1e6))
        .collect::<Result<Vec<_>, _>>()?;
    if weights.len() != rows[0].len() - 1 {
        return Err("Provide one comma-separated weight per criterion column.".into());
    }
    let sum: f64 = weights.iter().sum();
    if sum == 0. {
        return Err("At least one weight must be positive.".into());
    }
    let mut output = Vec::new();
    for row in &rows[1..] {
        let mut contributions = serde_json::Map::new();
        let mut score = 0.;
        for (index, weight) in weights.iter().enumerate() {
            let value = number(&row[index + 1], "Score", 0., 10.)? * weight / sum;
            score += value;
            contributions.insert(
                format!("{}: {}", index + 1, rows[0][index + 1]),
                json!(value),
            );
        }
        output.push(json!({"option":row[0],"weightedScore":score,"contributions":contributions}));
    }
    output.sort_by(|a, b| {
        b["weightedScore"]
            .as_f64()
            .unwrap()
            .total_cmp(&a["weightedScore"].as_f64().unwrap())
    });
    Ok(table(output))
}

fn escape_ics(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .replace('\n', "\\n")
        .replace(';', "\\;")
        .replace(',', "\\,")
}
fn fold_ics(line: &str) -> String {
    let mut out = String::new();
    let mut bytes = 0;
    for ch in line.chars() {
        if bytes + ch.len_utf8() > 75 {
            out.push_str("\r\n ");
            bytes = 1;
        }
        out.push(ch);
        bytes += ch.len_utf8();
    }
    out.push_str("\r\n");
    out
}
pub fn calendar(input: &str, options: &Value) -> Result<Value, String> {
    let parse = |key, default| {
        NaiveDateTime::parse_from_str(option(options, key, default), "%Y-%m-%dT%H:%M")
            .map_err(|_| format!("{key}: use YYYY-MM-DDTHH:MM in UTC."))
    };
    let start = parse("start", "2026-10-01T09:00")?;
    let end = parse("end", "2026-10-01T10:00")?;
    if end <= start {
        return Err("Event end must be after its start.".into());
    }
    if !(1..=9999).contains(&start.year()) || !(1..=9999).contains(&end.year()) {
        return Err("Event years must be between 1 and 9999.".into());
    }
    let title = option(options, "title", "Team catch-up");
    if title.trim().is_empty() {
        return Err("Enter an event title.".into());
    }
    let uid = option(options, "uid", "");
    if uid.is_empty()
        || uid.len() > 128
        || !uid
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.@".contains(&b))
    {
        return Err("Invalid event identifier.".into());
    }
    for text in [input, title, option(options, "location", "")] {
        if text
            .chars()
            .any(|ch| ch.is_control() && !['\r', '\n', '\t'].contains(&ch))
        {
            return Err("Calendar text contains an unsupported control character.".into());
        }
    }
    let stamp = chrono::DateTime::from_timestamp(options["now"].as_i64().unwrap_or(0), 0)
        .ok_or("Invalid creation time.")?;
    let lines = vec![
        "BEGIN:VCALENDAR".into(),
        "VERSION:2.0".into(),
        "PRODID:-//L5Z12//Tools//EN".into(),
        "BEGIN:VEVENT".into(),
        format!("UID:{uid}"),
        format!("DTSTAMP:{}", stamp.format("%Y%m%dT%H%M%SZ")),
        format!("DTSTART:{}Z", start.format("%Y%m%dT%H%M%S")),
        format!("DTEND:{}Z", end.format("%Y%m%dT%H%M%S")),
        format!("SUMMARY:{}", escape_ics(title)),
        format!("LOCATION:{}", escape_ics(option(options, "location", ""))),
        format!("DESCRIPTION:{}", escape_ics(input)),
        "END:VEVENT".into(),
        "END:VCALENDAR".into(),
    ];
    let text = lines.iter().map(|line| fold_ics(line)).collect::<String>();
    Ok(
        json!({"kind":"code","text":text,"files":[file("event.ics","text/calendar",text.as_bytes())]}),
    )
}
