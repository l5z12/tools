// SPDX-License-Identifier: AGPL-3.0-only
use super::{named_csv, number, report, setting};
use crate::workbench::{data, option, table};
use serde_json::{json, Value};

pub fn recipe(input: &str, options: &Value) -> Result<Value, String> {
    let original = setting(options, "original", "4", 0.001, 1_000_000.)?;
    let desired = setting(options, "desired", "6", 0.001, 1_000_000.)?;
    let mut rows = Vec::new();
    for row in named_csv(input, &["ingredient", "quantity", "unit"])? {
        let quantity = if let Some((a, b)) = row[1].split_once('/') {
            number(a, "Fraction numerator", 0., 1e9)?
                / number(b, "Fraction denominator", 0.000001, 1e9)?
        } else {
            number(&row[1], "Quantity", 0., 1e9)?
        };
        rows.push(json!({
            "ingredient": row[0],
            "original": quantity,
            "scaled": quantity * desired / original,
            "unit": row[2],
        }));
    }
    Ok(table(rows))
}

// Parse fixed-point amounts without binary floating-point rounding.
fn hundredths(input: &str, label: &str) -> Result<u64, String> {
    let input = input.trim();
    let (whole, fraction) = input.split_once('.').unwrap_or((input, ""));
    if whole.is_empty()
        || !whole.bytes().all(|b| b.is_ascii_digit())
        || fraction.len() > 2
        || !fraction.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(format!(
            "{label}: use a nonnegative decimal with at most two decimal places."
        ));
    }
    let whole = whole
        .parse::<u64>()
        .map_err(|_| format!("{label} is too large."))?;
    if whole > 1_000_000_000 {
        return Err(format!("{label} is too large."));
    }
    let fraction = format!("{fraction:0<2}").parse::<u64>().unwrap_or(0);
    Ok(whole * 100 + fraction)
}
fn money(cents: u64) -> String {
    format!("{}.{:02}", cents / 100, cents % 100)
}

pub fn bill(input: &str, options: &Value) -> Result<Value, String> {
    let names: Vec<_> = input
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if names.is_empty() || names.len() > 1000 {
        return Err("Enter 1–1,000 participants, one per line.".into());
    }
    let amount = hundredths(option(options, "amount", "120.00"), "Bill")?;
    let tax = hundredths(option(options, "tax", "0"), "Tax")?;
    let tip_rate = hundredths(option(options, "tip", "10"), "Tip percentage")?;
    if tip_rate > 10_000 {
        return Err("Tip percentage must be between 0 and 100.".into());
    }
    let tip = (amount * tip_rate + 5000) / 10_000;
    let total = amount + tax + tip;
    let count = names.len() as u64;
    let rows = names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let extra_cent = u64::from((index as u64) < total % count);
            let share = total / count + extra_cent;
            json!({ "participant": name, "amount": money(share) })
        })
        .collect();
    let summary = json!({
        "subtotal": money(amount),
        "tax": money(tax),
        "tip": money(tip),
        "total": money(total),
    });
    Ok(report(rows, summary))
}

pub fn unit_price(input: &str) -> Result<Value, String> {
    let mut rows = Vec::new();
    for row in named_csv(input, &["item", "price", "quantity"])? {
        let price = number(&row[1], "Price", 0., 1e12)?;
        let quantity = number(&row[2], "Quantity", 1e-9, 1e12)?;
        rows.push(json!({
            "item": row[0],
            "price": price,
            "quantity": quantity,
            "pricePerUnit": price / quantity,
        }));
    }
    rows.sort_by(|a, b| {
        a["pricePerUnit"]
            .as_f64()
            .unwrap()
            .total_cmp(&b["pricePerUnit"].as_f64().unwrap())
    });
    Ok(table(rows))
}

pub fn print_size(options: &Value) -> Result<Value, String> {
    let width = setting(options, "width", "210", 0.01, 100_000.)?;
    let height = setting(options, "height", "297", 0.01, 100_000.)?;
    let dpi = setting(options, "dpi", "300", 1., 10_000.)?;
    let inches = match option(options, "unit", "mm") {
        "mm" => 1. / 25.4,
        "cm" => 1. / 2.54,
        "inches" => 1.,
        _ => return Err("Unknown print unit.".into()),
    };
    let pixel_width = (width * inches * dpi).ceil() as u64;
    let pixel_height = (height * inches * dpi).ceil() as u64;
    let pixels = pixel_width * pixel_height;
    Ok(data(json!({
        "pixelWidth": pixel_width,
        "pixelHeight": pixel_height,
        "megapixels": pixels as f64 / 1e6,
        "widthInches": width * inches,
        "heightInches": height * inches,
        "dpi": dpi,
        "uncompressedRgbBytes": (pixels * 3).to_string(),
    })))
}
