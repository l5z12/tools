// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, table};
use quote::ToTokens;
use serde_json::{json, Value};
use syn::{spanned::Spanned, visit::Visit, Item};

#[derive(Default)]
struct Outline {
    rows: Vec<Value>,
    scope: Vec<String>,
}
impl<'ast> Visit<'ast> for Outline {
    fn visit_item(&mut self, item: &'ast Item) {
        let (kind, name) = match item {
            Item::Fn(v) => ("function", v.sig.ident.to_string()),
            Item::Struct(v) => ("struct", v.ident.to_string()),
            Item::Enum(v) => ("enum", v.ident.to_string()),
            Item::Trait(v) => ("trait", v.ident.to_string()),
            Item::Type(v) => ("type alias", v.ident.to_string()),
            Item::Const(v) => ("constant", v.ident.to_string()),
            Item::Static(v) => ("static", v.ident.to_string()),
            Item::Mod(v) => ("module", v.ident.to_string()),
            Item::Union(v) => ("union", v.ident.to_string()),
            Item::Use(v) => ("import", v.tree.to_token_stream().to_string()),
            Item::Impl(v) => ("implementation", v.self_ty.to_token_stream().to_string()),
            Item::Macro(v) => ("macro", v.mac.path.to_token_stream().to_string()),
            _ => ("item", String::new()),
        };
        self.push(kind, &name, item.span());
        self.scope.push(name);
        syn::visit::visit_item(self, item);
        self.scope.pop();
    }
    fn visit_impl_item_fn(&mut self, item: &'ast syn::ImplItemFn) {
        self.push("method", &item.sig.ident.to_string(), item.span());
        syn::visit::visit_impl_item_fn(self, item);
    }
    fn visit_trait_item_fn(&mut self, item: &'ast syn::TraitItemFn) {
        self.push("trait method", &item.sig.ident.to_string(), item.span());
        syn::visit::visit_trait_item_fn(self, item);
    }
}
impl Outline {
    fn push(&mut self, kind: &str, name: &str, span: proc_macro2::Span) {
        self.rows.push(json!({"kind":kind,"name":name,"scope":self.scope.join("::"),"line":span.start().line,"column":span.start().column+1}));
    }
}

pub fn execute(id: &str, text: &str, options: &Value) -> Result<Value, String> {
    crate::limits::check(text.len(), 256 * 1024, "Rust source is limited to 256 KiB.")?;
    match id {
        "rust-demangle" => {
            let rows = text.lines().filter(|line| !line.trim().is_empty()).map(|line| {
                let symbol = line.trim();
                match rustc_demangle::try_demangle(symbol) {
                    Ok(value) => json!({"symbol":symbol,"demangled":if options["hash"] == true {format!("{value}")}else{format!("{value:#}")},"status":"Rust symbol"}),
                    Err(_) => json!({"symbol":symbol,"demangled":symbol,"status":"Not a recognized Rust symbol"}),
                }
            }).collect();
            Ok(table(rows))
        }
        "rust-source" => {
            let file = syn::parse_file(text).map_err(|error| {
                format!(
                    "Line {}, column {}: {}",
                    error.span().start().line,
                    error.span().start().column + 1,
                    error
                )
            })?;
            let mut outline = Outline::default();
            outline.visit_file(&file);
            Ok(data(
                json!({"syntax":"Parsed successfully (macros are not expanded; types are not checked)","items":outline.rows,"shebang":file.shebang}),
            ))
        }
        _ => Err("Unknown Rust source tool.".into()),
    }
}
