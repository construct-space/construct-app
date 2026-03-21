//! Anthropic OAuth PKCE flow + Construct auth + Codex token reading.

use crate::config::normalize_api_base;

use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct OAuthTokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub token_type: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

struct OAuthPendingAuth {
    state: String,
    code_verifier: String,
    client_id: String,
    redirect_uri: String,
}

impl Clone for OAuthPendingAuth {
    fn clone(&self) -> Self {
        Self {
            state: self.state.clone(),
            code_verifier: self.code_verifier.clone(),
            client_id: self.client_id.clone(),
            redirect_uri: self.redirect_uri.clone(),
        }
    }
}

pub struct OAuthState {
    pending_auth: Option<OAuthPendingAuth>,
}

pub type SharedOAuthState = Arc<Mutex<OAuthState>>;

pub fn new_state() -> SharedOAuthState {
    Arc::new(Mutex::new(OAuthState { pending_auth: None }))
}

fn generate_pkce() -> (String, String) {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    use sha2::{Digest, Sha256};

    let mut verifier_bytes = [0u8; 32];
    getrandom::getrandom(&mut verifier_bytes).unwrap_or_default();
    let verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    let hash = hasher.finalize();
    let challenge = URL_SAFE_NO_PAD.encode(hash);

    (verifier, challenge)
}

fn generate_state() -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let mut state_bytes = [0u8; 32];
    getrandom::getrandom(&mut state_bytes).unwrap_or_default();
    URL_SAFE_NO_PAD.encode(state_bytes)
}

#[tauri::command]
pub async fn oauth_start(
    _app: tauri::AppHandle,
    oauth_state: tauri::State<'_, SharedOAuthState>,
    client_id: String,
    scopes: Vec<String>,
) -> Result<String, String> {
    let (code_verifier, code_challenge) = generate_pkce();
    let state = generate_state();

    let redirect_uri = "https://console.anthropic.com/oauth/code/callback".to_string();

    let default_scopes = vec![
        "org%3Acreate_api_key",
        "user%3Aprofile",
        "user%3Ainference",
        "user%3Asessions%3Aclaude_code",
    ];
    let scope = if scopes.is_empty() {
        default_scopes.join("+")
    } else {
        scopes
            .iter()
            .map(|s| s.replace(":", "%3A"))
            .collect::<Vec<_>>()
            .join("+")
    };

    let auth_url = format!(
        "https://claude.ai/oauth/authorize?code=true&client_id={}&response_type=code&redirect_uri={}&scope={}&code_challenge={}&code_challenge_method=S256&state={}",
        client_id,
        urlencoding::encode(&redirect_uri),
        scope,
        code_challenge,
        state
    );

    {
        let mut oauth = oauth_state.lock().map_err(|_| "Lock error")?;
        oauth.pending_auth = Some(OAuthPendingAuth {
            state: state.clone(),
            code_verifier,
            client_id,
            redirect_uri,
        });
    }

    eprintln!("[OAuth] Starting OAuth flow with state: {}", state);
    eprintln!("[OAuth] Auth URL: {}", auth_url);

    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(&auth_url).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open")
            .arg(&auth_url)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("rundll32")
            .args(&["url.dll,FileProtocolHandler", &auth_url])
            .spawn();
    }

    Ok(state)
}

#[tauri::command]
pub fn oauth_get_pending(
    oauth_state: tauri::State<'_, SharedOAuthState>,
) -> Result<serde_json::Value, String> {
    let oauth = oauth_state.lock().map_err(|_| "Lock error")?;

    if let Some(ref pending) = oauth.pending_auth {
        Ok(serde_json::json!({
            "state": pending.state,
            "code_verifier": pending.code_verifier,
            "client_id": pending.client_id,
            "redirect_uri": pending.redirect_uri
        }))
    } else {
        Err("No pending OAuth flow".to_string())
    }
}

#[tauri::command]
pub async fn oauth_exchange(
    app: tauri::AppHandle,
    oauth_state: tauri::State<'_, SharedOAuthState>,
    code: String,
    state: String,
) -> Result<OAuthTokenResponse, String> {
    eprintln!("[OAuth] Starting token exchange for code, state: {}", state);

    let pending = {
        let oauth = oauth_state.lock().map_err(|_| "Lock error")?;
        oauth.pending_auth.clone()
    }
    .ok_or("No pending OAuth flow")?;

    eprintln!("[OAuth] Got pending auth, trying direct HTTP exchange first...");

    let (actual_code, code_state) = if code.contains('#') {
        let parts: Vec<&str> = code.splitn(2, '#').collect();
        (
            parts[0].to_string(),
            Some(parts.get(1).map(|s| s.to_string()).unwrap_or_default()),
        )
    } else {
        (code.clone(), None)
    };

    eprintln!(
        "[OAuth] Code split: actual_code={}, has_state={}",
        &actual_code[..20.min(actual_code.len())],
        code_state.is_some()
    );

    let mut token_body = serde_json::json!({
        "grant_type": "authorization_code",
        "code": actual_code,
        "client_id": pending.client_id,
        "redirect_uri": pending.redirect_uri,
        "code_verifier": pending.code_verifier
    });

    if let Some(ref s) = code_state {
        token_body["state"] = serde_json::json!(s);
    }

    let client = reqwest::Client::builder()
        .user_agent("claude-cli/2.1.2 (external, cli)")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    // Try console.anthropic.com first
    eprintln!("[OAuth] Trying console.anthropic.com endpoint...");
    let console_result = client
        .post("https://console.anthropic.com/v1/oauth/token")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .json(&token_body)
        .send()
        .await;

    match console_result {
        Ok(response) => {
            let status = response.status();
            eprintln!("[OAuth] Console response status: {}", status);
            if status.is_success() {
                match response.json::<OAuthTokenResponse>().await {
                    Ok(token_response) => {
                        if token_response.error.is_none() && !token_response.access_token.is_empty()
                        {
                            eprintln!("[OAuth] Console endpoint succeeded!");
                            let mut oauth = oauth_state.lock().map_err(|_| "Lock error")?;
                            oauth.pending_auth = None;
                            return Ok(token_response);
                        }
                        eprintln!(
                            "[OAuth] Console got error in response: {:?}",
                            token_response.error
                        );
                    }
                    Err(e) => eprintln!("[OAuth] Console parse error: {}", e),
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                eprintln!("[OAuth] Console error body: {}", body);
            }
        }
        Err(e) => eprintln!("[OAuth] Console request error: {}", e),
    }

    // Try claude.ai
    eprintln!("[OAuth] Trying claude.ai endpoint with browser headers...");
    let claude_result = client
        .post("https://claude.ai/oauth/token")
        .header("Content-Type", "application/json")
        .header("Accept", "application/json")
        .header("Origin", "https://claude.ai")
        .header("Referer", "https://claude.ai/")
        .json(&token_body)
        .send()
        .await;

    match claude_result {
        Ok(response) => {
            let status = response.status();
            eprintln!("[OAuth] Claude.ai response status: {}", status);
            if status.is_success() {
                match response.json::<OAuthTokenResponse>().await {
                    Ok(token_response) => {
                        if token_response.error.is_none() && !token_response.access_token.is_empty()
                        {
                            eprintln!("[OAuth] Claude.ai endpoint succeeded!");
                            let mut oauth = oauth_state.lock().map_err(|_| "Lock error")?;
                            oauth.pending_auth = None;
                            return Ok(token_response);
                        }
                        eprintln!(
                            "[OAuth] Claude.ai got error in response: {:?}",
                            token_response.error
                        );
                    }
                    Err(e) => eprintln!("[OAuth] Claude.ai parse error: {}", e),
                }
            } else {
                let body = response.text().await.unwrap_or_default();
                eprintln!("[OAuth] Claude.ai error body: {}", body);
            }
        }
        Err(e) => eprintln!("[OAuth] Claude.ai request error: {}", e),
    }

    eprintln!("[OAuth] Direct HTTP failed, falling back to webview...");

    let window_label = format!("oauth-exchange-{}", state);
    eprintln!("[OAuth] Creating off-screen webview for token exchange");

    let exchange_window = WebviewWindowBuilder::new(
        &app,
        &window_label,
        WebviewUrl::External("https://claude.ai".parse().unwrap()),
    )
    .title("Authenticating...")
    .inner_size(400.0, 300.0)
    .position(-2000.0, -2000.0)
    .build()
    .map_err(|e| format!("Failed to create exchange window: {}", e))?;

    eprintln!("[OAuth] Waiting for Cloudflare to pass...");
    tokio::time::sleep(Duration::from_secs(5)).await;

    let exchange_js = format!(
        r#"
        (async () => {{
            try {{
                document.title = 'OAUTH_WORKING...';
                const body = {{
                    grant_type: 'authorization_code',
                    code: '{}',
                    client_id: '{}',
                    redirect_uri: '{}',
                    code_verifier: '{}'
                }};
                {}
                const response = await fetch('https://claude.ai/oauth/token', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify(body)
                }});
                const data = await response.json();
                document.title = 'OAUTH_DONE:' + JSON.stringify(data);
            }} catch (e) {{
                document.title = 'OAUTH_DONE:' + JSON.stringify({{ error: e.message }});
            }}
        }})()
        "#,
        actual_code,
        pending.client_id,
        pending.redirect_uri,
        pending.code_verifier,
        if let Some(ref s) = code_state {
            format!("body.state = '{}';", s)
        } else {
            String::new()
        }
    );

    eprintln!("[OAuth] Executing token exchange fetch...");

    let result = exchange_window.eval(&exchange_js);
    if let Err(e) = result {
        let _ = exchange_window.close();
        return Err(format!("Failed to execute exchange: {}", e));
    }

    for _ in 0..30 {
        tokio::time::sleep(Duration::from_millis(500)).await;

        if let Ok(title) = exchange_window.title() {
            if title.starts_with("OAUTH_DONE:") {
                let json_str = title.trim_start_matches("OAUTH_DONE:");
                eprintln!("[OAuth] Got result: {}", json_str);

                let _ = exchange_window.close();

                {
                    let mut oauth = oauth_state.lock().map_err(|_| "Lock error")?;
                    oauth.pending_auth = None;
                }

                let token_response: OAuthTokenResponse = serde_json::from_str(json_str)
                    .map_err(|e| format!("Failed to parse token response: {}", e))?;

                if token_response.error.is_some() {
                    return Err(format!(
                        "OAuth error: {} - {}",
                        token_response.error.unwrap_or_default(),
                        token_response.error_description.unwrap_or_default()
                    ));
                }

                return Ok(token_response);
            }
        }
    }

    let _ = exchange_window.close();
    Err("Token exchange timed out".to_string())
}

#[tauri::command]
pub async fn oauth_close_window(_app: tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn oauth_read_keychain() -> Result<OAuthTokenResponse, String> {
    use std::process::Command;

    eprintln!("[OAuth] Reading tokens from Claude Code keychain...");

    let output = Command::new("security")
        .args(&[
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .map_err(|e| format!("Failed to read keychain: {}", e))?;

    if !output.status.success() {
        return Err("Claude Code credentials not found in keychain. Please authenticate with Claude Code first.".to_string());
    }

    let json_str =
        String::from_utf8(output.stdout).map_err(|e| format!("Invalid keychain data: {}", e))?;

    #[derive(Deserialize)]
    struct ClaudeCodeOAuth {
        #[serde(rename = "accessToken")]
        access_token: String,
        #[serde(rename = "refreshToken")]
        refresh_token: Option<String>,
        #[serde(rename = "expiresAt")]
        expires_at: Option<u64>,
    }

    #[derive(Deserialize)]
    struct ClaudeCodeCredentials {
        #[serde(rename = "claudeAiOauth")]
        claude_ai_oauth: Option<ClaudeCodeOAuth>,
    }

    let creds: ClaudeCodeCredentials = serde_json::from_str(&json_str)
        .map_err(|e| format!("Failed to parse credentials: {}", e))?;

    let oauth = creds
        .claude_ai_oauth
        .ok_or("No Claude AI OAuth credentials found")?;

    if let Some(expires_at) = oauth.expires_at {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        if expires_at < now {
            return Err(
                "Claude Code token is expired. Please re-authenticate with Claude Code."
                    .to_string(),
            );
        }
    }

    eprintln!("[OAuth] Successfully read token from keychain");

    Ok(OAuthTokenResponse {
        access_token: oauth.access_token,
        refresh_token: oauth.refresh_token,
        expires_in: None,
        token_type: Some("Bearer".to_string()),
        error: None,
        error_description: None,
    })
}

#[tauri::command]
pub async fn construct_auth_exchange_code(
    api_base: String,
    api_key: String,
    body: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let token_url = format!("{}/oauth/construct/token", normalize_api_base(&api_base));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .post(&token_url)
        .header("Content-Type", "application/json")
        .header("X-Api-Key", &api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Construct token exchange request failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read token exchange response: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Construct token exchange failed ({}): {}",
            status, text
        ));
    }

    serde_json::from_str(&text).map_err(|e| format!("Invalid token exchange response: {}", e))
}

#[tauri::command]
pub async fn construct_auth_profile(
    api_base: String,
    api_key: String,
    access_token: String,
) -> Result<serde_json::Value, String> {
    let profile_url = format!("{}/oauth/construct/profile", normalize_api_base(&api_base));
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(&profile_url)
        .header("X-Api-Key", &api_key)
        .header("X-Construct-Token", &access_token)
        .send()
        .await
        .map_err(|e| format!("Construct profile request failed: {}", e))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read profile response: {}", e))?;

    if !status.is_success() {
        return Err(format!(
            "Construct profile request failed ({}): {}",
            status, text
        ));
    }

    serde_json::from_str(&text).map_err(|e| format!("Invalid profile response: {}", e))
}

#[tauri::command]
pub fn codex_read_tokens() -> Result<serde_json::Value, String> {
    let home = std::env::var("HOME").map_err(|_| "No HOME")?;
    let path = format!("{}/.codex/auth.json", home);
    let data = std::fs::read_to_string(&path).map_err(|_| {
        "Codex not installed or not authenticated. Install with: npm i -g @openai/codex"
    })?;
    let auth: serde_json::Value =
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse codex auth: {}", e))?;

    let tokens = auth.get("tokens").ok_or("No tokens in codex auth")?;
    let access = tokens
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if access.is_empty() {
        return Err("No access token in codex auth".to_string());
    }

    let account_id = tokens
        .get("account_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(serde_json::json!({
        "access_token": access,
        "refresh_token": tokens.get("refresh_token").and_then(|v| v.as_str()).unwrap_or(""),
        "account_id": account_id,
    }))
}
