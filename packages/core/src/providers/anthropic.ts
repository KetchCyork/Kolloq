import { createAnthropic } from "@ai-sdk/anthropic";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  authType?: "api_key" | "subscription";
  /** OAuth subscription bearer token (Claude Pro/Max). Used when `authType` is `"subscription"`. */
  accessToken?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS). */
  fetchImpl?: typeof fetch;
}

export function createAnthropicProvider(config: AnthropicProviderConfig = {}): ChatProvider {
  const model = config.model ?? "claude-3-5-sonnet-20241022";
  const useSubscription = config.authType === "subscription" && !!config.accessToken;
  const anthropic = useSubscription
    ? createSubscriptionAnthropic(config.accessToken as string, config.baseURL, config.fetchImpl)
    : createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL, fetch: config.fetchImpl });
  return new AiSdkChatProvider("anthropic", model, anthropic(model));
}

/**
 * Anthropic's subscription OAuth mode authenticates with a bearer token plus the
 * `anthropic-beta: oauth-2025-04-20` marker, and must NOT send an `x-api-key` header.
 * We pass a placeholder apiKey so the SDK doesn't try to read one from the environment,
 * then rewrite the outgoing headers via a fetch wrapper.
 *
 * NOTE: the exact bearer/beta contract is Anthropic's published OAuth flow and still needs
 * live end-to-end verification against a real Claude Pro/Max account (see NEW-67).
 */
function createSubscriptionAnthropic(accessToken: string, baseURL?: string, fetchImpl?: typeof fetch) {
  // Wrap the platform fetch (Tauri-backed in the desktop shell) so the token exchange also bypasses
  // webview CORS — calling the global `fetch` here would be blocked just like a plain API-key call.
  const baseFetch = fetchImpl ?? fetch;
  const oauthFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("anthropic-beta", "oauth-2025-04-20");
    return baseFetch(input, { ...init, headers });
  };
  return createAnthropic({ apiKey: "oauth-subscription-placeholder", baseURL, fetch: oauthFetch });
}
