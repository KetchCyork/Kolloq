/**
 * Outbound provider (inference) HTTP for the desktop shell.
 *
 * Provider APIs — `api.anthropic.com`, `api.openai.com`, Google's Generative Language endpoint —
 * do not send `Access-Control-Allow-Origin` for the app's origin, so a `fetch` issued from the
 * Tauri webview is rejected by CORS before it leaves the process (the same wall documented in
 * `subscriptionAuth.ts` for the OAuth token endpoint, and worked around there via Rust). Without a
 * native relay the AI SDK's request fails and — because a stream error surfaces as an empty
 * completion rather than a thrown error — the user just sees a blank reply. That's the "none of the
 * agents responded" bug.
 *
 * This module provides a `fetch`-compatible function that performs the request in Rust
 * (`provider_fetch`), which isn't subject to browser CORS.
 */
import { isTauriRuntime } from "./credentials";

interface ProviderFetchResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: string;
}

async function invokeProviderFetch(
  url: string,
  method: string,
  headers: [string, string][],
  body: string | null,
): Promise<ProviderFetchResponse> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProviderFetchResponse>("provider_fetch", { request: { url, method, headers, body } });
}

/**
 * A `fetch` that routes through the Rust `provider_fetch` command. The native side buffers the full
 * response, so a streamed provider reply is delivered as a single chunk rather than token-by-token —
 * acceptable for correctness; incremental streaming would be a follow-up.
 */
const tauriProviderFetch: typeof fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = request ? request.url : typeof input === "string" ? input : input.toString();
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();

  const headerList: [string, string][] = [];
  const collect = (source: HeadersInit | undefined) => {
    if (!source) return;
    new Headers(source).forEach((value, key) => headerList.push([key, value]));
  };
  if (request) collect(request.headers);
  collect(init?.headers);

  let body: string | null = null;
  if (init?.body != null) {
    body = typeof init.body === "string" ? init.body : String(init.body);
  } else if (request) {
    const requestText = await request.text();
    body = requestText.length > 0 ? requestText : null;
  }

  const res = await invokeProviderFetch(url, method, headerList, body);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
};

/**
 * The `fetch` provider factories should use for outbound inference. In the Tauri desktop shell this
 * routes through Rust to bypass webview CORS; in the plain browser build there's no native layer, so
 * we return `undefined` and providers fall back to the global `fetch` (which works for CORS-enabled
 * providers like OpenRouter and is CORS-blocked for Anthropic/OpenAI — a known limit of that build).
 */
export function getProviderFetch(): typeof fetch | undefined {
  return isTauriRuntime() ? tauriProviderFetch : undefined;
}
