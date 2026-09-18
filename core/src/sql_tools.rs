// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{code, data, option, table};
use serde_json::{json, Value};
use sqlparser::{dialect::*, parser::Parser, tokenizer::Tokenizer};
use std::collections::BTreeSet;

fn dialect(name: &str) -> Result<Box<dyn Dialect>, String> {
    Ok(match name {
        "sqlite" => Box::new(SQLiteDialect {}),
        "postgres" => Box::new(PostgreSqlDialect {}),
        "mysql" => Box::new(MySqlDialect {}),
        "mssql" => Box::new(MsSqlDialect {}),
        "generic" => Box::new(GenericDialect {}),
        _ => return Err("Unknown SQL dialect.".into()),
    })
}

fn quote_identifier(name: &str, dialect: &str) -> Result<String, String> {
    if name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control) {
        return Err("Identifiers must contain 1–1,024 bytes with no control characters.".into());
    }
    Ok(match dialect {
        "mysql" => format!("`{}`", name.replace('`', "``")),
        "mssql" => format!("[{}]", name.replace(']', "]]")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    })
}

fn literal(value: &Value, dialect: &str) -> Result<String, String> {
    match value {
        Value::Null => Ok("NULL".into()),
        Value::Bool(value) => Ok(match (dialect, value) {
            ("postgres" | "generic", true) => "TRUE",
            ("postgres" | "generic", false) => "FALSE",
            (_, true) => "1",
            (_, false) => "0",
        }
        .into()),
        Value::Number(value) => Ok(value.to_string()),
        Value::String(value) => {
            if value.contains('\0') {
                return Err("SQL text literals cannot contain NUL characters.".into());
            }
            let escaped = value.replace('\'', "''");
            Ok(match dialect {
                // MySQL's default string syntax treats backslashes as escapes.
                // Hex strings avoid depending on NO_BACKSLASH_ESCAPES.
                "mysql" => format!(
                    "CONVERT(X'{}' USING utf8mb4)",
                    hex::encode(value.as_bytes())
                ),
                "mssql" => format!("N'{escaped}'"),
                "postgres" => format!("E'{}'", escaped.replace('\\', "\\\\")),
                _ => format!("'{escaped}'"),
            })
        }
        _ => Err("Use scalar values; nested objects and arrays cannot be SQL literals.".into()),
    }
}

fn inserts(columns: &[String], rows: &[Vec<Value>], options: &Value) -> Result<Value, String> {
    let dialect_name = option(options, "dialect", "sqlite");
    dialect(dialect_name)?;
    if rows.is_empty() || rows.len() > 10_000 || columns.is_empty() || columns.len() > 256 {
        return Err("Provide 1–10,000 rows and 1–256 columns.".into());
    }
    let table_name = quote_identifier(option(options, "table", "people"), dialect_name)?;
    let columns = columns
        .iter()
        .map(|name| quote_identifier(name, dialect_name))
        .collect::<Result<Vec<_>, _>>()?
        .join(", ");
    let mut output = String::new();
    for row in rows {
        let values = row
            .iter()
            .map(|value| literal(value, dialect_name))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        output.push_str(&format!(
            "INSERT INTO {table_name} ({columns}) VALUES ({values});\n"
        ));
        if output.len() > 8 * 1024 * 1024 {
            return Err("Generated SQL exceeds 8 MiB.".into());
        }
    }
    Ok(code(output, "sql"))
}

pub fn execute(id: &str, source: &[u8], options: &Value) -> Result<Value, String> {
    if source.len() > 2_000_000 {
        return Err("SQL tools accept up to 2 MiB of text.".into());
    }
    let input = std::str::from_utf8(source).map_err(|_| "Input must be UTF-8.")?;
    let dialect_name = option(options, "dialect", "sqlite");
    let dialect = dialect(dialect_name)?;
    match id {
        "sql-inspect" | "sql-normalize" => {
            let statements =
                Parser::parse_sql(dialect.as_ref(), input).map_err(|error| error.to_string())?;
            if statements.is_empty() || statements.len() > 1000 {
                return Err("Provide 1–1,000 SQL statements.".into());
            }
            let normalized: Vec<_> = statements
                .iter()
                .map(|statement| format!("{statement};"))
                .collect();
            if id == "sql-normalize" {
                return Ok(code(normalized.join("\n"), "sql"));
            }
            let rows: Vec<_> = normalized
                .iter()
                .enumerate()
                .map(|(index, sql)| {
                    json!({
                        "statement": index + 1,
                        "sql": sql,
                    })
                })
                .collect();
            let mut result = data(json!({
                "dialect": dialect_name,
                "statements": rows,
                "ast": statements,
            }));
            result["rows"] = json!(rows);
            Ok(result)
        }
        "sql-tokens" => {
            let tokens = Tokenizer::new(dialect.as_ref(), input)
                .tokenize_with_location()
                .map_err(|error| error.to_string())?;
            if tokens.len() > 20_000 {
                return Err("Input exceeds 20,000 tokens.".into());
            }
            Ok(table(
                tokens
                    .iter()
                    .map(|token| {
                        json!({
                            "line": token.span.start.line,
                            "column": token.span.start.column,
                            "token": token.token.to_string(),
                            "kind": format!("{:?}", token.token),
                        })
                    })
                    .collect(),
            ))
        }
        "sql-json-inserts" => {
            let value: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
            let objects = value.as_array().ok_or("Provide a JSON array of objects.")?;
            if objects.is_empty() || objects.len() > 10_000 {
                return Err("Provide 1–10,000 rows.".into());
            }
            let mut columns = BTreeSet::new();
            for object in objects {
                columns.extend(
                    object
                        .as_object()
                        .ok_or("Every row must be an object.")?
                        .keys()
                        .cloned(),
                );
                if columns.len() > 256 {
                    return Err("Provide at most 256 columns.".into());
                }
            }
            let columns: Vec<_> = columns.into_iter().collect();
            let rows: Vec<_> = objects
                .iter()
                .map(|object| {
                    columns
                        .iter()
                        .map(|column| object[column].clone())
                        .collect()
                })
                .collect();
            inserts(&columns, &rows, options)
        }
        "sql-csv-inserts" => {
            let delimiter = match option(options, "delimiter", "Comma") {
                "Comma" => b',',
                "Tab" => b'\t',
                "Semicolon" => b';',
                _ => return Err("Unknown delimiter.".into()),
            };
            let mut reader = csv::ReaderBuilder::new()
                .delimiter(delimiter)
                .from_reader(source);
            let columns: Vec<_> = reader
                .headers()
                .map_err(|error| error.to_string())?
                .iter()
                .map(str::to_string)
                .collect();
            if columns.iter().collect::<BTreeSet<_>>().len() != columns.len() {
                return Err("CSV headers must be unique.".into());
            }
            if columns.is_empty() || columns.len() > 256 {
                return Err("Provide 1–256 columns.".into());
            }
            let null_token = option(options, "nullToken", "\\N");
            let mut rows = Vec::new();
            for record in reader.records() {
                let record = record.map_err(|error| error.to_string())?;
                rows.push(
                    record
                        .iter()
                        .map(|cell| {
                            if !null_token.is_empty() && cell == null_token {
                                Value::Null
                            } else {
                                json!(cell)
                            }
                        })
                        .collect(),
                );
                if rows.len() > 10_000 {
                    return Err("CSV exceeds 10,000 rows.".into());
                }
            }
            inserts(&columns, &rows, options)
        }
        "sql-in-list" => {
            let value: Value = serde_json::from_str(input).map_err(|error| error.to_string())?;
            let values = value
                .as_array()
                .ok_or("Provide a JSON array of scalar values.")?;
            if values.is_empty() || values.len() > 10_000 {
                return Err("Provide 1–10,000 values.".into());
            }
            let values = values
                .iter()
                .map(|value| literal(value, dialect_name))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(code(format!("({})", values.join(", ")), "sql"))
        }
        _ => Err("Unknown SQL tool.".into()),
    }
}
