use serde::Serialize;
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// Token endpoints this command is willing to relay a POST to. Kept explicit (rather than taking
/// any URL from the frontend) so this can't become an open SSRF proxy if the webview content were
/// ever compromised.
const ALLOWED_TOKEN_URLS: &[&str] = &[
    "https://console.anthropic.com/v1/oauth/token",
    // Open Work account "Continue with Google" (OpenID Connect) token exchange.
    "https://oauth2.googleapis.com/token",
];

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

#[derive(Serialize, Debug)]
pub struct LoopbackCapture {
    code: String,
    state: String,
}

/// Parses `code`/`state` (or an OAuth `error`) out of the query string of the loopback redirect
/// request line, e.g. `GET /?code=abc&state=xyz HTTP/1.1`.
fn parse_loopback_redirect(request_line: &str) -> Result<LoopbackCapture, String> {
    // Request line is `METHOD <path?query> HTTP/1.1`.
    let path_and_query = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path_and_query.split_once('?').map(|(_, q)| q).unwrap_or("");
    let mut code = String::new();
    let mut state = String::new();
    let mut error = String::new();
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = url_decode(value);
        match key {
            "code" => code = value,
            "state" => state = value,
            "error" => error = value,
            _ => {}
        }
    }
    if !error.is_empty() {
        return Err(format!("Google sign-in was denied or cancelled ({error})."));
    }
    if code.is_empty() {
        return Err("Google redirect did not include an authorization code.".to_string());
    }
    Ok(LoopbackCapture { code, state })
}

/// Minimal percent-decoding for query values (also turns `+` into a space).
fn url_decode(input: &str) -> String {
    let bytes = input.replace('+', " ");
    let bytes = bytes.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Binds a one-shot loopback listener on `127.0.0.1:<port>`, waits for Google's OAuth redirect,
/// and returns the captured `code`/`state`. The frontend opens the consent page after invoking
/// this (see runGoogleSignIn); Google redirects back here once the user authorizes.
///
/// This is required because Google removed the out-of-band ("paste the code") flow: native apps
/// must use a loopback redirect, which a browser webview can't host on its own.
#[tauri::command]
pub async fn google_oauth_capture(port: u16) -> Result<LoopbackCapture, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(("127.0.0.1", port)).map_err(|err| format!("Could not start loopback listener on port {port}: {err}"))?;
        // Guard against a user who abandons the browser: don't wait forever for a connection.
        listener.set_nonblocking(false).ok();
        let (mut stream, _) = listener.accept().map_err(|err| format!("Loopback accept failed: {err}"))?;
        stream.set_read_timeout(Some(Duration::from_secs(300))).ok();

        let mut buf = [0u8; 2048];
        let n = stream.read(&mut buf).map_err(|err| format!("Loopback read failed: {err}"))?;
        let request = String::from_utf8_lossy(&buf[..n]);
        let request_line = request.lines().next().unwrap_or("");
        let result = parse_loopback_redirect(request_line);

        // Respond so the browser tab shows a friendly message either way.
        let (title, message) = match &result {
            Ok(_) => ("Signed in", "You're signed in to OpenWork. You can close this tab and return to the app."),
            Err(_) => ("Sign-in failed", "Something went wrong signing in. You can close this tab and try again in OpenWork."),
        };
        let html = format!(
            "<!doctype html><html><head><meta charset=utf-8><title>{title}</title><style>body{{font-family:-apple-system,system-ui,sans-serif;background:#0f1115;color:#e6e6e6;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}div{{text-align:center;max-width:24rem}}h1{{font-size:1.25rem}}</style></head><body><div><h1>{title}</h1><p>{message}</p></div></body></html>"
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();

        result
    })
    .await
    .map_err(|err| format!("Loopback task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_the_known_token_endpoints() {
        assert!(is_allowed_token_url("https://console.anthropic.com/v1/oauth/token"));
        assert!(is_allowed_token_url("https://oauth2.googleapis.com/token"));
        assert!(!is_allowed_token_url("https://evil.example/v1/oauth/token"));
        assert!(!is_allowed_token_url("https://console.anthropic.com.evil.example/v1/oauth/token"));
    }

    #[test]
    fn parses_code_and_state_from_redirect() {
        let cap = parse_loopback_redirect("GET /?code=abc123&state=xyz789&scope=email HTTP/1.1").unwrap();
        assert_eq!(cap.code, "abc123");
        assert_eq!(cap.state, "xyz789");
    }

    #[test]
    fn percent_decodes_query_values() {
        let cap = parse_loopback_redirect("GET /?code=a%2Fb%3Dc&state=s HTTP/1.1").unwrap();
        assert_eq!(cap.code, "a/b=c");
    }

    #[test]
    fn surfaces_oauth_errors() {
        let err = parse_loopback_redirect("GET /?error=access_denied HTTP/1.1").unwrap_err();
        assert!(err.contains("access_denied"));
    }

    #[test]
    fn rejects_a_redirect_with_no_code() {
        assert!(parse_loopback_redirect("GET /?state=only HTTP/1.1").is_err());
    }
}
