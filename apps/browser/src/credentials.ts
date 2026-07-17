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
