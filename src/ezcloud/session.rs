use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, Once,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use hbb_common::{
    base64::{
        engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
        Engine,
    },
    config::{Config, LocalConfig},
    log,
};

use super::oidc::{self, Discovery, TokenSet};

struct Session {
    presence: String,
    presence_exp: u64,
    access_token: String,
    access_exp: u64,
    refresh_token: String,
}

static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static CANCEL: AtomicBool = AtomicBool::new(false);
static LOGIN_RUNNING: AtomicBool = AtomicBool::new(false);

pub fn on_login_command(value: &str) {
    match value {
        "start" => start_login(),
        "cancel" => {
            CANCEL.store(true, Ordering::SeqCst);
            put_local("ezcloud-login-status", "signed-out");
            put_local("ezcloud-login-error", "");
        }
        "logout" => start_logout(),
        _ => {}
    }
}

pub fn presence_token() -> String {
    SESSION
        .lock()
        .unwrap()
        .as_ref()
        .map(|session| session.presence.clone())
        .unwrap_or_default()
}

pub fn clear_local(reason: &str) {
    *SESSION.lock().unwrap() = None;
    delete_refresh();
    put_local("ezcloud-presence-token", "");
    put_local("ezcloud-signed-in", "");
    put_local("ezcloud-role", "");
    put_local("ezcloud-display-name", "");
    put_local("ezcloud-email", "");
    if reason.is_empty() {
        put_local("ezcloud-login-status", "signed-out");
        put_local("ezcloud-login-error", "");
    } else {
        put_local("ezcloud-login-status", "error");
        put_local("ezcloud-login-error", reason);
    }
}

pub fn abandon_interrupted_login() {
    if interrupted_login(&LocalConfig::get_option("ezcloud-login-status")) {
        put_local("ezcloud-login-status", "signed-out");
        put_local("ezcloud-login-error", "");
    }
}

fn interrupted_login(status: &str) -> bool {
    status == "starting" || status == "waiting"
}

pub fn restore_in_background() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        thread::spawn(|| {
            let Some(refresh) = load_refresh() else {
                if presence_expired() {
                    clear_local("");
                }
                return;
            };
            if let Err(err) = restore_with_refresh(&refresh) {
                log::info!("ezID restore skipped: {err}");
                if presence_expired() {
                    clear_local("");
                }
            }
        });
    });
}

fn start_login() {
    if LOGIN_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    CANCEL.store(false, Ordering::SeqCst);
    thread::spawn(|| {
        struct Running;
        impl Drop for Running {
            fn drop(&mut self) {
                LOGIN_RUNNING.store(false, Ordering::SeqCst);
            }
        }
        let _running = Running;
        if let Err(err) = run_login() {
            if CANCEL.load(Ordering::SeqCst) {
                put_local("ezcloud-login-status", "signed-out");
                put_local("ezcloud-login-error", "");
            } else {
                put_local("ezcloud-login-status", "error");
                put_local("ezcloud-login-error", &err);
                log::info!("ezID login failed: {err}");
            }
        }
    });
}

fn start_logout() {
    thread::spawn(|| {
        let (presence, refresh, device_uuid) = {
            let guard = SESSION.lock().unwrap();
            match guard.as_ref() {
                Some(session) => (
                    session.presence.clone(),
                    session.refresh_token.clone(),
                    device_uuid(),
                ),
                None => (
                    presence_from_file(),
                    load_refresh().unwrap_or_default(),
                    device_uuid(),
                ),
            }
        };
        let refresh = if refresh.is_empty() {
            load_refresh().unwrap_or_default()
        } else {
            refresh
        };
        if !presence.is_empty() {
            let _ = revoke_presence(&presence, &device_uuid);
        }
        if !refresh.is_empty() {
            if let Ok(discovery) = oidc::fetch_discovery(&issuer()) {
                oidc::revoke_refresh(&discovery, &client_id(), &refresh);
            }
        }
        clear_local("");
    });
}

fn run_login() -> Result<(), String> {
    let client_id = client_id();
    if client_id.is_empty() {
        return Err("Chưa có client_id ezID. Điền mã public client do team ezID cấp.".to_owned());
    }
    let issuer = issuer();
    let redirect_uri = redirect_uri();
    put_local("ezcloud-login-status", "starting");
    put_local("ezcloud-login-error", "");
    let discovery = oidc::fetch_discovery(&issuer).map_err(|err| err.to_string())?;
    let request = oidc::new_login_request();
    let url = oidc::authorize_url(&discovery, &client_id, &redirect_uri, &scopes(), &request)
        .map_err(|err| err.to_string())?;
    let result_url =
        oidc::auth_result_url(&redirect_uri, &request.state).map_err(|err| err.to_string())?;
    let cancel = &CANCEL;
    let waiter = thread::spawn(move || oidc::poll_for_auth_code(&result_url, cancel));
    thread::sleep(Duration::from_millis(200));
    open_browser(&url);
    if CANCEL.load(Ordering::SeqCst) {
        return Err("Đã hủy đăng nhập".to_owned());
    }
    put_local("ezcloud-login-status", "waiting");
    let code = waiter
        .join()
        .map_err(|_| "Luồng chờ đăng nhập dừng.".to_owned())?
        .map_err(|err| err.to_string())?;
    let tokens = oidc::exchange_code(
        &discovery.token_endpoint,
        &client_id,
        &redirect_uri,
        &code,
        &request.verifier,
    )
    .map_err(|err| err.to_string())?;
    accept_tokens(&discovery, &issuer, &client_id, &request.nonce, tokens)
}

fn restore_with_refresh(refresh_token: &str) -> Result<(), String> {
    let client_id = client_id();
    if client_id.is_empty() {
        return Err("missing client id".to_owned());
    }
    let issuer = issuer();
    let discovery = oidc::fetch_discovery(&issuer).map_err(|err| err.to_string())?;
    let tokens = oidc::refresh_access(&discovery.token_endpoint, &client_id, refresh_token)
        .map_err(|err| err.to_string())?;
    accept_tokens(&discovery, &issuer, &client_id, "", tokens)
}

fn accept_tokens(
    discovery: &Discovery,
    issuer: &str,
    client_id: &str,
    nonce: &str,
    mut tokens: TokenSet,
) -> Result<(), String> {
    if !tokens.id_token.is_empty() {
        let jwks = oidc::fetch_jwks(&discovery.jwks_uri).map_err(|err| err.to_string())?;
        oidc::verify_id_token(&tokens.id_token, issuer, client_id, nonce, &jwks)
            .map_err(|err| err.to_string())?;
    }
    let device_uuid = device_uuid();
    let device_id = Config::get_id();
    let presence = request_presence(&tokens.access_token, &device_uuid, &device_id)?;
    if tokens.refresh_token.is_empty() {
        if let Some(existing) = SESSION.lock().unwrap().as_ref() {
            tokens.refresh_token = existing.refresh_token.clone();
        }
    }
    if !tokens.refresh_token.is_empty() {
        store_refresh(&tokens.refresh_token)?;
    }
    let now = now_secs();
    let access_exp = now.saturating_add(tokens.expires_in);
    let presence_exp = now.saturating_add(presence.expires_in);
    {
        let mut guard = SESSION.lock().unwrap();
        *guard = Some(Session {
            presence: presence.token.clone(),
            presence_exp,
            access_token: tokens.access_token,
            access_exp,
            refresh_token: tokens.refresh_token,
        });
    }
    put_local("ezcloud-presence-token", &presence.token);
    put_local("ezcloud-signed-in", "Y");
    put_local("ezcloud-role", &presence.role);
    put_local("ezcloud-display-name", &presence.name);
    put_local("ezcloud-email", &presence.email);
    put_local("ezcloud-login-status", "signed-in");
    put_local("ezcloud-login-error", "");
    ensure_refresh_thread();
    Ok(())
}

fn ensure_refresh_thread() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        thread::spawn(|| loop {
            thread::sleep(Duration::from_secs(30));
            renew_if_due();
        });
    });
}

fn renew_if_due() {
    let due = {
        let guard = SESSION.lock().unwrap();
        match guard.as_ref() {
            Some(session) => now_secs().saturating_add(120) >= session.presence_exp,
            None => false,
        }
    };
    if !due {
        return;
    }
    let refresh = {
        let guard = SESSION.lock().unwrap();
        guard
            .as_ref()
            .map(|session| session.refresh_token.clone())
            .filter(|token| !token.is_empty())
            .or_else(load_refresh)
    };
    let Some(refresh) = refresh else {
        clear_local("Phiên ezID hết hạn. Đăng nhập lại.");
        return;
    };
    if let Err(err) = restore_with_refresh(&refresh) {
        log::info!("ezID refresh failed: {err}");
        clear_local("Không gia hạn được phiên ezID. Đăng nhập lại.");
    }
}

struct PresenceIssued {
    token: String,
    expires_in: u64,
    role: String,
    name: String,
    email: String,
}

fn request_presence(access_token: &str, device_uuid: &str, device_id: &str) -> Result<PresenceIssued, String> {
    let broker = broker();
    let response = http_client()
        .map_err(|err| err.to_string())?
        .post(format!("{broker}/v1/sessions"))
        .header("authorization", format!("Bearer {access_token}"))
        .json(&serde_json::json!({
            "device_uuid": device_uuid,
            "device_id": device_id,
        }))
        .send()
        .map_err(|_| "Không gọi được broker ezCloud.".to_owned())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Broker từ chối phiên ({status})."));
    }
    let body: serde_json::Value = response
        .json()
        .map_err(|_| "Broker trả phiên không đọc được.".to_owned())?;
    let token = body
        .get("presence_token")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .to_owned();
    if token.is_empty() {
        return Err("Broker không trả presence token.".to_owned());
    }
    Ok(PresenceIssued {
        token,
        expires_in: body
            .get("expires_in")
            .and_then(|item| item.as_u64())
            .unwrap_or(600),
        role: body
            .get("role")
            .and_then(|item| item.as_str())
            .unwrap_or("customer")
            .to_owned(),
        name: body
            .get("name")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_owned(),
        email: body
            .get("email")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .to_owned(),
    })
}

fn revoke_presence(presence: &str, device_uuid: &str) -> Result<(), String> {
    let response = http_client()
        .map_err(|err| err.to_string())?
        .delete(format!("{}/v1/sessions/current", broker()))
        .header("authorization", format!("Bearer {presence}"))
        .json(&serde_json::json!({ "device_uuid": device_uuid }))
        .send()
        .map_err(|_| "Không thu hồi được phiên.".to_owned())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err("Broker không thu hồi phiên.".to_owned())
    }
}

fn http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| err.to_string())
}

fn device_uuid() -> String {
    STANDARD.encode(hbb_common::get_uuid())
}

pub fn publish_runtime_config() {
    put_local("ezcloud-broker", &broker());
}

fn issuer() -> String {
    setting("EZID_ISSUER", "https://id.ezcloud.vn")
}

fn client_id() -> String {
    setting("EZID_CLIENT_ID", "ezcloud-remote")
}

fn broker() -> String {
    setting("EZCLOUD_BROKER", "https://remote.ezcloud.vn")
        .trim_end_matches('/')
        .to_owned()
}

fn scopes() -> String {
    setting("EZID_SCOPES", "openid profile email roles offline_access")
}

fn redirect_uri() -> String {
    setting(
        "EZID_REDIRECT_URI",
        "https://remote.ezcloud.vn/auth/callback",
    )
}

fn setting(env_key: &str, default_value: &str) -> String {
    if let Ok(value) = std::env::var(env_key) {
        let value = value.trim();
        if !value.is_empty() {
            return value.to_owned();
        }
    }
    super::env::get(env_key).unwrap_or_else(|| default_value.to_owned())
}

fn put_local(key: &str, value: &str) {
    LocalConfig::set_option(key.to_owned(), value.to_owned());
}

fn presence_from_file() -> String {
    LocalConfig::get_option("ezcloud-presence-token")
}

fn presence_expired() -> bool {
    let token = presence_from_file();
    if token.is_empty() {
        return false;
    }
    let Some(payload) = token.split('.').nth(1) else {
        return true;
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload) else {
        return true;
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return true;
    };
    let exp = value.get("exp").and_then(|item| item.as_u64()).unwrap_or(0);
    exp <= now_secs().saturating_add(30)
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn open_browser(url: &str) {
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        #[cfg(target_os = "macos")]
        let mut command = std::process::Command::new("open");
        #[cfg(target_os = "windows")]
        let mut command = std::process::Command::new("cmd");
        #[cfg(target_os = "linux")]
        let mut command = std::process::Command::new("xdg-open");
        #[cfg(target_os = "windows")]
        {
            command.args(["/C", "start", "", url]);
        }
        #[cfg(not(target_os = "windows"))]
        {
            command.arg(url);
        }
        let _ = command.spawn();
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    let _ = url;
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn store_refresh(token: &str) -> Result<(), String> {
    let entry = keyring::Entry::new("ezRemote", "ezid-refresh").map_err(|err| err.to_string())?;
    entry.set_password(token).map_err(|err| err.to_string())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn load_refresh() -> Option<String> {
    let entry = keyring::Entry::new("ezRemote", "ezid-refresh").ok()?;
    entry.get_password().ok().filter(|token| !token.is_empty())
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn delete_refresh() {
    if let Ok(entry) = keyring::Entry::new("ezRemote", "ezid-refresh") {
        let _ = entry.delete_credential();
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn store_refresh(_token: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn load_refresh() -> Option<String> {
    None
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn delete_refresh() {}

#[cfg(test)]
mod tests {
    use super::interrupted_login;

    #[test]
    fn an_interrupted_login_does_not_keep_the_button_disabled() {
        assert!(interrupted_login("waiting"));
        assert!(interrupted_login("starting"));
        assert!(!interrupted_login("error"));
        assert!(!interrupted_login("signed-out"));
        assert!(!interrupted_login("signed-in"));
    }
}
