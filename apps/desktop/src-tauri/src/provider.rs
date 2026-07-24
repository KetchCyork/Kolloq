use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Provider API hosts this command is willing to relay to. Kept as an explicit allow-list (same
/// philosophy as `oauth.rs`'s `ALLOWED_TOKEN_URLS`) so that if the webview content were ever
/// compromised, this can't be turned into an open SSRF proxy. Host-only match; any path is allowed.
///
/// Only `api.openai.com` is listed today (see NEW-184): Anthropic sends work via the
/// `anthropic-dangerous-direct-browser-access` header (NEW-41), and Google/OpenRouter already
/// return CORS headers for the app's origin, so only OpenAI needs this native relay. Extend the
/// list if another provider is found to need it.
const ALLOWED_HOSTS: &[&str] = &["api.openai.com"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFetchRequest {
    url: String,
    method: String,
    /// Request headers as `[name, value]` pairs, forwarded verbatim from the AI SDK's `fetch`.
    headers: Vec<(String, String)>,
    body: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFetchResponse {
    status: u16,
    status_text: String,
    headers: Vec<(String, String)>,
    body: String,
}

fn host_allowed(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(parsed) => parsed
            .host_str()
            .map(|host| ALLOWED_HOSTS.contains(&host))
            .unwrap_or(false),
        Err(_) => false,
    }
}

/// Performs an outbound provider HTTP request (chat/inference) from the Rust side instead of the
/// webview.
///
/// `api.openai.com` does not return `Access-Control-Allow-Origin` for the app's origin on
/// `/v1/chat/completions` — it's meant to be called from a native/CLI context, not a browser tab —
/// so a `fetch` issued from the frontend is rejected by WKWebView before the request even leaves
/// the process. This is the exact same CORS wall the codebase already works around for the OAuth
/// token endpoint (see `oauth.rs`). Making the same request from Rust isn't subject to that
/// browser-only restriction, so OpenAI-backed agents can actually get a response.
///
/// The full response is buffered and returned as text (provider responses are SSE / JSON, both
/// UTF-8), so streaming reaches the UI as a single chunk rather than token-by-token — acceptable
/// for correctness; incremental streaming would be a follow-up.
#[tauri::command]
pub async fn provider_fetch(request: ProviderFetchRequest) -> Result<ProviderFetchResponse, String> {
    if !host_allowed(&request.url) {
        return Err(format!(
            "Host is not on the provider allow-list: {}",
            request.url
        ));
    }

    // reqwest's rustls backend needs a process-wide crypto provider installed once; mirror
    // oauth.rs / tauri-plugin-updater's lazy install so this works regardless of call order.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }

    let method = reqwest::Method::from_bytes(request.method.to_uppercase().as_bytes())
        .map_err(|err| format!("Invalid HTTP method: {err}"))?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|err| err.to_string())?;

    let mut builder = client.request(method, &request.url);
    for (name, value) in &request.headers {
        let lower = name.to_ascii_lowercase();
        // Drop framing / connection headers the client must own. We don't enable reqwest's
        // compression features, so strip `accept-encoding` too: that guarantees the server returns
        // an un-encoded body we can hand back as UTF-8 text.
        if matches!(
            lower.as_str(),
            "host" | "content-length" | "connection" | "accept-encoding"
        ) {
            continue;
        }
        builder = builder.header(name.as_str(), value.as_str());
    }
    if let Some(body) = request.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|err| err.to_string())?;
    let status = resp.status().as_u16();
    let status_text = resp
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();

    let mut headers = Vec::new();
    for (name, value) in resp.headers().iter() {
        let lower = name.as_str().to_ascii_lowercase();
        // The body is returned already-decoded as a string, so drop the framing/encoding headers
        // that would otherwise make the rebuilt JS `Response` advertise a mismatched length/encoding.
        if matches!(
            lower.as_str(),
            "content-length" | "content-encoding" | "transfer-encoding"
        ) {
            continue;
        }
        if let Ok(v) = value.to_str() {
            headers.push((name.as_str().to_string(), v.to_string()));
        }
    }

    let body = resp.text().await.map_err(|err| err.to_string())?;
    Ok(ProviderFetchResponse {
        status,
        status_text,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_the_openai_chat_host() {
        assert!(host_allowed("https://api.openai.com/v1/chat/completions"));
        assert!(!host_allowed("https://api.anthropic.com/v1/messages"));
        assert!(!host_allowed("https://api.openai.com.evil.example/v1/chat/completions"));
        assert!(!host_allowed("not a url"));
    }
}
