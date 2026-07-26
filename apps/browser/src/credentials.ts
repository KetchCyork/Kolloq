/**
 * Provider API keys are secrets. In the browser build there is nowhere secure
 * to put them, so they stay inline in the session record in IndexedDB (same
 * trust boundary as the rest of the page). Under the Tauri desktop shell an
 * OS keychain is available, so this module routes keys there instead and
 * strips them out of what gets written to IndexedDB.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(command, args);
}

export async function saveApiKey(sessionId: string, apiKey: string): Promise<void> {
  await invoke<void>("set_credential", { key: sessionId, value: apiKey });
}

export async function loadApiKey(sessionId: string): Promise<string | undefined> {
  const value = await invoke<string | null>("get_credential", { key: sessionId });
  return value ?? undefined;
}

export async function deleteApiKey(sessionId: string): Promise<void> {
  await invoke<void>("delete_credential", { key: sessionId });
}

/** Namespaces an account id before it's used as a keychain/credential key, so it can't collide with a session id. */
export function accountCredentialKey(accountId: string): string {
  return `account:${accountId}`;
}

/** Keychain key for an account's OAuth subscription tokens, kept distinct from its API-key entry. */
export function accountOAuthKey(accountId: string): string {
  return `oauth:${accountId}`;
}

/**
 * Opens a URL in the user's default browser for OAuth login.
 *
 * In the plain browser build `window.open` is correct. Under the Tauri desktop shell it is NOT:
 * wry's WKWebView (macOS) implements none of the WKUIDelegate methods, so `window.open` — like
 * `window.alert/confirm/prompt` (NEW-206) — silently no-ops and returns null. That left the Google
 * OAuth flow stuck on "Waiting for Google…" forever, because the consent page never opened while
 * the Rust loopback listener blocked awaiting the redirect (NEW-195). Under Tauri we route through
 * the opener plugin, which hands the URL to the OS default browser.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriRuntime()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
