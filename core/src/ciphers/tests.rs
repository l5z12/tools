// SPDX-License-Identifier: AGPL-3.0-only
use super::*;
use serde_json::json;

#[test]
fn vectors() {
    for (id, s, o, expected) in [
        ("gronsfeld", "HELLO", json!({"key":"123"}), "IGOMQ"),
        ("trithemius", "AAAAA", json!({}), "ABCDE"),
        (
            "running-key",
            "ATTACKATDAWN",
            json!({"key":"LEMONLEMONLE"}),
            "LXFOPVEFRNHR",
        ),
        ("hill", "HELP", json!({}), "HIAT"),
        (
            "rc4",
            "Plaintext",
            json!({"key":"4b6579"}),
            "bbf316e8d940af0ad3",
        ),
    ] {
        assert_eq!(
            execute(&format!("cipher-{id}"), s, &o).unwrap()["text"],
            expected,
            "{id}"
        );
    }
}
#[test]
fn roundtrips() {
    for id in [
        "gronsfeld",
        "running-key",
        "trithemius",
        "hill",
        "four-square",
        "adfgx",
        "adfgvx",
        "trifid",
        "nihilist",
    ] {
        let mut o = json!({"key":if id=="gronsfeld"{"123"}else{"EXAMPLEEXAMPLEEXAMPLE"},"key2":"KEYWORD","transposition":"BANANA","period":"7"});
        for s in ["", "A", "HELLOWORLD", "ATTACKATDAWN"] {
            let e = execute(&format!("cipher-{id}"), s, &o).unwrap();
            o["mode"] = json!("Decrypt");
            let d = execute(&format!("cipher-{id}"), e["text"].as_str().unwrap(), &o).unwrap();
            let expected = if (id == "hill" || id == "four-square") && s.len() % 2 == 1 {
                format!("{s}X")
            } else {
                s.into()
            };
            assert_eq!(d["text"], expected, "{id}");
            o["mode"] = json!("Encrypt");
        }
    }
}
