// SPDX-License-Identifier: AGPL-3.0-only
use crate::workbench::{data, option};
use base64::{
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
    Engine,
};
use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde_json::{json, Value};
pub(super) fn verify(input: &str, opts: &Value) -> Result<Value, String> {
    let name = option(opts, "algorithm", "HS256");
    let algorithm = match name {
        "HS256" => Algorithm::HS256,
        "HS384" => Algorithm::HS384,
        "HS512" => Algorithm::HS512,
        "RS256" => Algorithm::RS256,
        "PS256" => Algorithm::PS256,
        "ES256" => Algorithm::ES256,
        "EdDSA" => Algorithm::EdDSA,
        _ => return Err("Select a supported algorithm.".into()),
    };
    let token = input.trim();
    let header: Value = serde_json::from_slice(
        &URL_SAFE_NO_PAD
            .decode(token.split('.').next().unwrap_or(""))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if header["alg"] != name || header.get("crit").is_some() || header["b64"] == false {
        return Err("Unexpected algorithm or unsupported critical JWT header.".into());
    }
    let raw = option(opts, "key", "");
    if raw.trim().is_empty() || crate::limits::over(raw.len(), 32768) {
        return Err("Provide a verification key up to 32 KiB.".into());
    }
    let key = match option(opts, "keyFormat", "text") {
        "jwk" => {
            let value: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            let kty = match algorithm {
                Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512 => "oct",
                Algorithm::ES256 => "EC",
                Algorithm::EdDSA => "OKP",
                _ => "RSA",
            };
            if value["kty"] != kty
                || value.get("alg").is_some_and(|v| v != name)
                || value.get("use").is_some_and(|v| v != "sig")
                || value.get("key_ops").is_some_and(|v| {
                    !v.as_array()
                        .is_some_and(|a| a.iter().any(|v| v == "verify"))
                })
            {
                return Err("JWK is not a verification key for the selected algorithm.".into());
            }
            DecodingKey::from_jwk(&serde_json::from_value(value).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        }
        "spki" => match algorithm {
            Algorithm::RS256 | Algorithm::PS256 => DecodingKey::from_rsa_pem(raw.as_bytes()),
            Algorithm::ES256 => DecodingKey::from_ec_pem(raw.as_bytes()),
            Algorithm::EdDSA => DecodingKey::from_ed_pem(raw.as_bytes()),
            _ => return Err("HMAC requires a shared secret.".into()),
        }
        .map_err(|e| e.to_string())?,
        format => {
            if !name.starts_with("HS") {
                return Err("Choose JWK or PEM SPKI for an asymmetric key.".into());
            }
            match format {
                "text" => DecodingKey::from_secret(raw.as_bytes()),
                "base64" => DecodingKey::from_secret(
                    &STANDARD.decode(raw.trim()).map_err(|e| e.to_string())?,
                ),
                _ => return Err("Unknown key format.".into()),
            }
        }
    };
    let mut validation = Validation::new(algorithm);
    validation.required_spec_claims.clear();
    // The host supplies wall-clock time; signature and claim decisions stay in WASM.
    validation.validate_exp = false;
    validation.validate_nbf = false;
    validation.validate_aud = false;
    let verified = decode::<Value>(token, &key, &validation).map_err(|e| e.to_string())?;
    let claims = verified.claims;
    if !claims.is_object() {
        return Err("JWT claims must be an object.".into());
    }
    let now = opts["now"].as_f64().ok_or("Current time is required.")?;
    for claim in ["exp", "nbf", "iat"] {
        if let Some(value) = claims.get(claim) {
            let value = value
                .as_f64()
                .filter(|v| v.is_finite())
                .ok_or("JWT time claims must be finite numbers.")?;
            if (claim == "exp" && value <= now) || (claim == "nbf" && value > now) {
                return Err("JWT is expired or not active yet.".into());
            }
        }
    }
    let issuer = option(opts, "issuer", "");
    let audience = option(opts, "audience", "");
    if !issuer.is_empty() && claims["iss"] != issuer {
        return Err("JWT issuer does not match.".into());
    }
    if !audience.is_empty()
        && claims["aud"] != audience
        && !claims["aud"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v == audience))
    {
        return Err("JWT audience does not match.".into());
    }
    Ok(data(json!({
        "verified": true,
        "header": header,
        "expirationPresent": claims.get("exp").is_some(),
        "claims": claims,
    })))
}
