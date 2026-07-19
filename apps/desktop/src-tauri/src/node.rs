//! Desktop Node execution context — the Rust side of the bridge.
//!
//! The webview front-end (the browser bundle) can't run the Node-only tools (the Office generators;
//! fs/shell/code-interpreter later). These Tauri commands are how the front-end reaches an
//! out-of-process Node runtime that can: for each call we resolve the session's sandbox directory,
//! spawn the sidecar (`sidecar/tool-host.mjs`), write one JSON request to its stdin, and hand its
//! stdout back to the front-end verbatim. The heavy lifting — building the tools, sandboxing,
//! rendering documents — happens in the sidecar (`@newvector/core`); Rust only owns the trusted
//! bits: *where* the sandbox lives and *that the request is scoped to it*.
//!
//! Sandbox-root policy stays here on purpose. The front-end passes a `session_id`, never a path, so
//! a compromised renderer can't point the Node runtime at an arbitrary directory — the root is
//! always `<app_local_data_dir>/sandboxes/<session_id>`, created on demand.

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::json;
use tauri::{AppHandle, Manager};

/// Resolves (and creates) the sandbox directory for a session under the app's local data dir.
/// The `session_id` is sanitized to a single path segment so it can't traverse out of `sandboxes/`.
fn sandbox_root(app: &AppHandle, session_id: &str) -> Result<PathBuf, String> {
    let safe: String = session_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if safe.is_empty() {
        return Err("Empty session id".into());
    }
    let base = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?;
    let root = base.join("sandboxes").join(safe);
    std::fs::create_dir_all(&root).map_err(|e| format!("Could not create sandbox dir: {e}"))?;
    Ok(root)
}

/// Locates the sidecar entry script. In a packaged app it's bundled under the resource dir; in dev
/// it lives next to the crate at `apps/desktop/sidecar/tool-host.mjs`.
fn sidecar_script(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("sidecar").join("tool-host.mjs");
        if bundled.exists() {
            return Ok(bundled);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("sidecar")
        .join("tool-host.mjs");
    if dev.exists() {
        return Ok(dev);
    }
    Err("Could not locate the Node sidecar (sidecar/tool-host.mjs).".into())
}

/// Runs the sidecar with `request` (a JSON string) on stdin and returns its stdout (a JSON
/// `NodeToolResponse`). The Node runtime is resolved from the `NEWVECTOR_NODE` env var if set,
/// otherwise `node` on PATH. Bundling a self-contained runtime is tracked as follow-up work.
fn run_sidecar(app: &AppHandle, request: String) -> Result<String, String> {
    let script = sidecar_script(app)?;
    let node = std::env::var("NEWVECTOR_NODE").unwrap_or_else(|_| "node".into());

    let mut child = Command::new(node)
        .arg(&script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start the Node sidecar: {e}"))?;

    child
        .stdin
        .take()
        .ok_or_else(|| "Sidecar stdin unavailable".to_string())?
        .write_all(request.as_bytes())
        .map_err(|e| format!("Failed to send request to the sidecar: {e}"))?;

    let output = child
        .wait_with_output()
        .map_err(|e| format!("Sidecar did not complete: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Node sidecar exited with an error: {stderr}"));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Runs a Node-only tool (by name, with the model's JSON-encoded arguments) in the session sandbox.
/// Returns the sidecar's raw JSON response for the front-end to parse.
#[tauri::command]
pub fn node_tool_exec(
    app: AppHandle,
    session_id: String,
    name: String,
    args: String,
) -> Result<String, String> {
    let root = sandbox_root(&app, &session_id)?;
    let parsed_args: serde_json::Value =
        serde_json::from_str(&args).map_err(|e| format!("Invalid tool arguments JSON: {e}"))?;
    let request = json!({
        "op": "exec",
        "sandboxRoot": root.to_string_lossy(),
        "name": name,
        "args": parsed_args,
    });
    run_sidecar(&app, request.to_string())
}

/// Reads a generated file back out of the session sandbox as base64 (the download read-back path).
#[tauri::command]
pub fn node_read_file(app: AppHandle, session_id: String, path: String) -> Result<String, String> {
    let root = sandbox_root(&app, &session_id)?;
    let request = json!({
        "op": "read",
        "sandboxRoot": root.to_string_lossy(),
        "path": path,
    });
    run_sidecar(&app, request.to_string())
}
