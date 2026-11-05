use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};

use hbb_common::{
    anyhow::{anyhow, bail, Result},
    base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine},
    rand::{rngs::OsRng, RngCore},
};
use jsonwebtoken::{decode, decode_header, Algorithm, DecodingKey, Validation};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub struct LoginRequest {
    pub state: String,
    pub nonce: String,
    pub verifier: String,
}

pub struct Discovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub jwks_uri: String,
    pub revocation_endpoint: String,
}

pub struct TokenSet {
    pub id_token: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

pub struct IdIdentity {
    pub sub: String,
}

pub fn new_login_request() -> LoginRequest {
    LoginRequest {
        state: random_url(32),
        nonce: random_url(32),
        verifier: random_url(32),
    }
}

pub fn pkce_s256(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub fn authorize_url(
    discovery: &Discovery,
    client_id: &str,
    redirect_uri: &str,
    scopes: &str,
    request: &LoginRequest,
) -> Result<String> {
    let mut url = url::Url::parse(&discovery.authorization_endpoint)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", scopes)
        .append_pair("state", &request.state)
        .append_pair("nonce", &request.nonce)
        .append_pair("code_challenge", &pkce_s256(&request.verifier))
        .append_pair("code_challenge_method", "S256");
    Ok(url.to_string())
}

pub fn revoke_refresh(discovery: &Discovery, client_id: &str, refresh_token: &str) {
    if discovery.revocation_endpoint.is_empty() || refresh_token.is_empty() || client_id.is_empty()
    {
        return;
    }
    let body = form(&[
        ("token", refresh_token),
        ("token_type_hint", "refresh_token"),
        ("client_id", client_id),
    ]);
    let _ = http_post_form(&discovery.revocation_endpoint, &body);
}

pub fn fetch_discovery(issuer: &str) -> Result<Discovery> {
    let url = format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    );
    let body = http_get(&url)?;
    let value: Value = serde_json::from_str(&body)?;
    Ok(Discovery {
        authorization_endpoint: required_str(&value, "authorization_endpoint")?,
        token_endpoint: required_str(&value, "token_endpoint")?,
        jwks_uri: required_str(&value, "jwks_uri")?,
        revocation_endpoint: value
            .get("revocation_endpoint")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_owned(),
    })
}

pub fn exchange_code(
    token_endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
) -> Result<TokenSet> {
    let body = form(&[
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", client_id),
        ("code_verifier", verifier),
    ]);
    let tokens = read_token_response(&http_post_form(token_endpoint, &body)?)?;
    if tokens.id_token.is_empty() {
        bail!("ezID không trả id_token");
    }
    Ok(tokens)
}

pub fn refresh_access(token_endpoint: &str, client_id: &str, refresh_token: &str) -> Result<TokenSet> {
    let body = form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ]);
    read_token_response(&http_post_form(token_endpoint, &body)?)
}

pub fn fetch_jwks(jwks_uri: &str) -> Result<String> {
    http_get(jwks_uri)
}

pub fn verify_id_token(
    token: &str,
    issuer: &str,
    audience: &str,
    nonce: &str,
    jwks_json: &str,
) -> Result<IdIdentity> {
    let header = decode_header(token).map_err(|_| anyhow!("id_token không đọc được"))?;
    if header.alg != Algorithm::RS256 {
        bail!("id_token không dùng RS256");
    }
    let kid = header
        .kid
        .ok_or_else(|| anyhow!("id_token thiếu kid"))?;
    let jwks: Value = serde_json::from_str(jwks_json).map_err(|_| anyhow!("JWKS không đọc được"))?;
    let key = jwks
        .get("keys")
        .and_then(|keys| keys.as_array())
        .and_then(|keys| {
            keys.iter().find(|item| {
                item.get("kid").and_then(|value| value.as_str()) == Some(kid.as_str())
            })
        })
        .ok_or_else(|| anyhow!("JWKS không có khóa của id_token"))?;
    let n = key
        .get("n")
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("JWKS thiếu modulus"))?;
    let e = key
        .get("e")
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("JWKS thiếu exponent"))?;
    let decoding = DecodingKey::from_rsa_components(n, e)
        .map_err(|_| anyhow!("Không dựng được khóa ezID"))?;
    let mut validation = Validation::new(Algorithm::RS256);
    let issuer = issuer.trim_end_matches('/');
    validation.set_issuer(&[issuer]);
    validation.set_audience(&[audience]);
    let data = decode::<IdClaims>(token, &decoding, &validation)
        .map_err(|_| anyhow!("id_token không hợp lệ"))?;
    if !nonce.is_empty() && data.claims.nonce.as_deref() != Some(nonce) {
        bail!("nonce của id_token không khớp");
    }
    if data.claims.sub.is_empty() {
        bail!("id_token thiếu sub");
    }
    Ok(IdIdentity {
        sub: data.claims.sub,
    })
}

pub fn auth_result_url(redirect_uri: &str, state: &str) -> Result<String> {
    let mut url = url::Url::parse(redirect_uri)?;
    url.set_path("/auth/result");
    url.set_query(None);
    url.query_pairs_mut().append_pair("state", state);
    Ok(url.into())
}

pub fn poll_for_auth_code(result_url: &str, cancel: &AtomicBool) -> Result<String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()?;
    let deadline = Instant::now() + Duration::from_secs(180);
    loop {
        if cancel.load(Ordering::SeqCst) {
            bail!("Đã hủy đăng nhập");
        }
        if Instant::now() > deadline {
            bail!("Hết thời gian chờ đăng nhập ezID");
        }
        if let Ok(response) = client.get(result_url).send() {
            if response.status().as_u16() == 200 {
                let body = response.text().unwrap_or_default();
                let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
                if value.get("error").and_then(|item| item.as_str()).is_some() {
                    bail!("ezID từ chối đăng nhập");
                }
                if let Some(code) = value.get("code").and_then(|item| item.as_str()) {
                    if !code.is_empty() {
                        return Ok(code.to_owned());
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(500));
    }
}

pub fn auth_code_from_target(target: &str, expected_state: &str) -> Result<String> {
    let query = target.split_once('?').map(|(_, query)| query).unwrap_or("");
    let pairs: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    if pairs.iter().any(|(key, _)| key == "error") {
        bail!("ezID từ chối đăng nhập");
    }
    let state = pairs
        .iter()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.as_str())
        .unwrap_or("");
    if state != expected_state {
        bail!("state đăng nhập không khớp");
    }
    pairs
        .into_iter()
        .find(|(key, _)| key == "code")
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("Thiếu authorization code"))
}

fn read_token_response(body: &str) -> Result<TokenSet> {
    let value: Value = serde_json::from_str(body).map_err(|_| anyhow!("ezID không trả token"))?;
    let access_token = value
        .get("access_token")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_owned();
    if access_token.is_empty() {
        bail!("ezID không trả access token");
    }
    let id_token = value
        .get("id_token")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_owned();
    Ok(TokenSet {
        id_token,
        access_token,
        refresh_token: value
            .get("refresh_token")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_owned(),
        expires_in: value.get("expires_in").and_then(|item| item.as_u64()).unwrap_or(3600),
    })
}

fn required_str(value: &Value, key: &str) -> Result<String> {
    value
        .get(key)
        .and_then(|item| item.as_str())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_owned())
        .ok_or_else(|| anyhow!("Discovery ezID thiếu {key}"))
}

fn form(pairs: &[(&str, &str)]) -> String {
    let mut serializer = url::form_urlencoded::Serializer::new(String::new());
    for (key, value) in pairs {
        serializer.append_pair(key, value);
    }
    serializer.finish()
}

fn http_get(url: &str) -> Result<String> {
    let response = http_client()?
        .get(url)
        .send()
        .map_err(|_| anyhow!("Không gọi được ezID"))?;
    let status = response.status();
    if !status.is_success() {
        bail!("ezID trả {status}");
    }
    response
        .text()
        .map_err(|_| anyhow!("ezID trả nội dung không đọc được"))
}

fn http_post_form(url: &str, body: &str) -> Result<String> {
    let response = http_client()?
        .post(url)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(body.to_owned())
        .send()
        .map_err(|_| anyhow!("Không đổi được mã đăng nhập ezID"))?;
    let status = response.status();
    if !status.is_success() {
        bail!("ezID từ chối đổi mã ({status})");
    }
    response
        .text()
        .map_err(|_| anyhow!("ezID trả nội dung không đọc được"))
}

fn http_client() -> Result<reqwest::blocking::Client> {
    Ok(reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()?)
}

fn random_url(size: usize) -> String {
    let mut bytes = vec![0u8; size];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

#[derive(Deserialize)]
struct IdClaims {
    sub: String,
    nonce: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_vector() {
        assert_eq!(
            pkce_s256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn callback_rejects_a_different_state() {
        let err = auth_code_from_target("/callback?code=abc&state=other", "expected").unwrap_err();
        assert!(err.to_string().contains("state"));
    }

    #[test]
    fn callback_returns_the_code_when_state_matches() {
        let code = auth_code_from_target("/callback?code=abc&state=expected", "expected").unwrap();
        assert_eq!(code, "abc");
    }

    #[test]
    fn auth_result_stays_on_the_public_host() {
        let url = auth_result_url("https://remote.ezcloud.vn/auth/callback", "abc").unwrap();
        assert_eq!(url, "https://remote.ezcloud.vn/auth/result?state=abc");
    }

    #[test]
    fn authorize_url_omits_client_secret() {
        let discovery = Discovery {
            authorization_endpoint: "https://dev-id.ezcloud.vn/connect/authorize".to_owned(),
            token_endpoint: "https://dev-id.ezcloud.vn/connect/token".to_owned(),
            jwks_uri: "https://dev-id.ezcloud.vn/jwks".to_owned(),
            revocation_endpoint: String::new(),
        };
        let request = LoginRequest {
            state: "state".to_owned(),
            nonce: "nonce".to_owned(),
            verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk".to_owned(),
        };
        let url = authorize_url(
            &discovery,
            "ezcloud-remote",
            "http://127.0.0.1:43821/callback",
            "openid profile email roles",
            &request,
        )
        .unwrap();
        assert!(!url.contains("client_secret"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));
    }
}
