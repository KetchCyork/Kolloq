use serde::Serialize;
use serde_json::Value;

/// Token endpoints this command is willing to relay a POST to. Kept explicit (rather than taking
/// any URL from the frontend) so this can't become an open SSRF proxy if the webview content were
/// ever compromised.
const ALLOWED_TOKEN_URLS: &[&str] = &["https://console.anthropic.com/v1/oauth/token"];

#[derive(Serialize)]
pub struct OAuthTokenResponse {
    status: u16,
    body: String,
}

/// Performs an OAuth token exchange/refresh POST from the Rust side instead of the webview.
///
/// Anthropic's token endpoint doesn't return CORS headers for third-party origins (it's meant to
/// be called from a CLI/native context, not a browser tab), so a `fetch` issued from the frontend
/// is blocked before the request even leaves the webview. Making the same POST from Rust isn't
/// subject to that browser-only restriction.
fn is_allowed_token_url(token_url: &str) -> bool {
    ALLOWED_TOKEN_URLS.contains(&token_url)
}

#[tauri::command]
pub async fn oauth_token_request(token_url: String, body: Value) -> Result<OAuthTokenResponse, String> {
    if !is_allowed_token_url(&token_url) {
        return Err(format!("Token URL is not on the allowed list: {token_url}"));
    }

    // reqwest's rustls backend needs a process-wide crypto provider installed once; mirror
    // tauri-plugin-updater's own lazy install so this works whether or not the updater has run yet.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let client = reqwest::Client::new();
    let resp = client
        .post(&token_url)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|err| err.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|err| err.to_string())?;
    Ok(OAuthTokenResponse { status, body: text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_the_known_anthropic_token_endpoint() {
        assert!(is_allowed_token_url("https://console.anthropic.com/v1/oauth/token"));
        assert!(!is_allowed_token_url("https://evil.example/v1/oauth/token"));
        assert!(!is_allowed_token_url("https://console.anthropic.com.evil.example/v1/oauth/token"));
    }
}
