import { createAnthropic } from "@ai-sdk/anthropic";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider, ModelOption } from "./types.js";

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  authType?: "api_key" | "subscription";
  /** OAuth subscription bearer token (Claude Pro/Max). Used when `authType` is `"subscription"`. */
  accessToken?: string;
}

export function createAnthropicProvider(config: AnthropicProviderConfig = {}): ChatProvider {
  const model = config.model ?? "claude-sonnet-5";
  const useSubscription = config.authType === "subscription" && !!config.accessToken;
  const anthropic = useSubscription
    ? createSubscriptionAnthropic(config.accessToken as string, config.baseURL)
    : createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL, fetch: browserAccessFetch });
  return new AiSdkChatProvider("anthropic", model, anthropic(model));
}

/**
 * There is no backend proxy for provider calls in this app: every request, including this one,
 * fires directly from renderer/browser JS. Anthropic's API rejects browser-origin requests
 * unless this header is present, so its CORS preflight fails and the call dies silently with no
 * visible error. Exported for unit testing.
 */
export const browserAccessFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set("anthropic-dangerous-direct-browser-access", "true");
  return fetch(input, { ...init, headers });
};

/**
 * Anthropic's subscription OAuth mode authenticates with a bearer token plus the
 * `anthropic-beta: oauth-2025-04-20` marker, and must NOT send an `x-api-key` header.
 * We pass a placeholder apiKey so the SDK doesn't try to read one from the environment,
 * then rewrite the outgoing headers via a fetch wrapper.
 *
 * NOTE: the exact bearer/beta contract is Anthropic's published OAuth flow and still needs
 * live end-to-end verification against a real Claude Pro/Max account (see NEW-67).
 */
function createSubscriptionAnthropic(accessToken: string, baseURL?: string) {
  const oauthFetch: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.delete("x-api-key");
    headers.set("authorization", `Bearer ${accessToken}`);
    headers.set("anthropic-beta", "oauth-2025-04-20");
    headers.set("anthropic-dangerous-direct-browser-access", "true");
    return fetch(input, { ...init, headers });
  };
  return createAnthropic({ apiKey: "oauth-subscription-placeholder", baseURL, fetch: oauthFetch });
}

/**
 * Lists the models available to this account via `GET /v1/models`, so callers can offer a
 * dropdown instead of a free-text model field. Includes
 * `anthropic-dangerous-direct-browser-access` because this fetch runs directly from renderer/
 * browser JS (no backend proxy exists for provider calls in this app) and Anthropic's API
 * otherwise rejects browser-origin requests.
 */
export async function listAnthropicModels(config: AnthropicProviderConfig = {}): Promise<ModelOption[]> {
  const baseURL = (config.baseURL ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (config.authType === "subscription" && config.accessToken) {
    headers.authorization = `Bearer ${config.accessToken}`;
    headers["anthropic-beta"] = "oauth-2025-04-20";
  } else if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  } else {
    throw new Error("An API key (or subscription sign-in) is required to list Anthropic models.");
  }

  const response = await fetch(`${baseURL}/models?limit=1000`, { headers });
  if (!response.ok) {
    throw new Error(`Anthropic model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name }));
}
