// SPDX-License-Identifier: AGPL-3.0-only
mod build_files;
mod symbols;

use crate::workbench::{code, option};
use serde_json::Value;

pub fn execute(id: &str, bytes: &[u8], options: &Value) -> Result<Value, String> {
    crate::limits::check(bytes.len(), 2 * 1024 * 1024, "Input is limited to 2 MiB.")?;
    if id == "cpp-byte-array" {
        return byte_array(bytes, options);
    }
    let input = std::str::from_utf8(bytes).map_err(|_| "Input must be UTF-8 text.")?;
    match id {
        "cpp-demangle" => symbols::demangle(input),
        "cpp-diagnostics" => symbols::diagnostics(input),
        "cpp-compilation-db" => build_files::compilation_database(input),
        "cpp-cmake-cache" => build_files::cmake_cache(input, options),
        _ => Err("Unknown C/C++ tool.".into()),
    }
}

fn byte_array(bytes: &[u8], options: &Value) -> Result<Value, String> {
    crate::limits::check(
        bytes.len(),
        64 * 1024,
        "Choose up to 64 KiB for a source array.",
    )?;
    let name = option(options, "name", "payload");
    let identifier = regex::Regex::new(r"^[A-Za-z][A-Za-z0-9_]{0,63}$").unwrap();
    const KEYWORDS: &[&str] = &[
        "auto",
        "bool",
        "break",
        "case",
        "catch",
        "char",
        "class",
        "const",
        "constexpr",
        "continue",
        "default",
        "delete",
        "do",
        "double",
        "else",
        "enum",
        "explicit",
        "extern",
        "false",
        "float",
        "for",
        "friend",
        "goto",
        "if",
        "inline",
        "int",
        "long",
        "namespace",
        "new",
        "nullptr",
        "operator",
        "private",
        "protected",
        "public",
        "register",
        "return",
        "short",
        "signed",
        "sizeof",
        "static",
        "struct",
        "switch",
        "template",
        "this",
        "throw",
        "true",
        "try",
        "typedef",
        "typename",
        "union",
        "unsigned",
        "using",
        "virtual",
        "void",
        "volatile",
        "while",
        "alignas",
        "alignof",
        "asm",
        "bitand",
        "bitor",
        "compl",
        "concept",
        "consteval",
        "constinit",
        "const_cast",
        "co_await",
        "co_return",
        "co_yield",
        "decltype",
        "dynamic_cast",
        "export",
        "mutable",
        "noexcept",
        "not",
        "not_eq",
        "or",
        "or_eq",
        "reinterpret_cast",
        "requires",
        "static_assert",
        "static_cast",
        "thread_local",
        "typeid",
        "wchar_t",
        "char8_t",
        "char16_t",
        "char32_t",
        "and",
        "and_eq",
        "xor",
        "xor_eq",
        "restrict",
        "std",
        "size_t",
        "ptrdiff_t",
        "max_align_t",
        "NULL",
        "offsetof",
    ];
    if !identifier.is_match(name) || name.contains("__") || KEYWORDS.contains(&name) {
        return Err(
            "Use a non-reserved identifier starting with a letter (up to 64 characters).".into(),
        );
    }
    let cpp = option(options, "language", "C") == "C++";
    let uppercase = options["uppercase"] == true;
    let mut values = bytes.to_vec();
    if options["terminator"] == true {
        values.push(0);
    }
    let mut lines = Vec::new();
    for chunk in values.chunks(12) {
        let values: Vec<String> = chunk
            .iter()
            .map(|byte| {
                if uppercase {
                    format!("0x{byte:02X}")
                } else {
                    format!("0x{byte:02x}")
                }
            })
            .collect();
        lines.push(format!("    {},", values.join(", ")));
    }
    let text = if cpp {
        format!("#include <array>\n#include <cstddef>\n\nconstexpr std::array<unsigned char, {}> {name} = {{{{\n{}\n}}}};\nconstexpr std::size_t {name}_size = {name}.size();\n", values.len(), lines.join("\n"))
    } else {
        // ISO C has no zero-length arrays. Keep a sentinel with a logical size of zero.
        if values.is_empty() {
            lines.push("    0x00,".into());
        }
        format!("#include <stddef.h>\n\nstatic const unsigned char {name}[] = {{\n{}\n}};\nstatic const size_t {name}_size = {};\n", lines.join("\n"), values.len())
    };
    Ok(code(text, if cpp { "cpp" } else { "c" }))
}
