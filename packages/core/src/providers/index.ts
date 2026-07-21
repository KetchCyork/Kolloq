import { createAnthropicProvider } from "./anthropic.js";
import { createGoogleProvider } from "./google.js";
import { createOllamaProvider } from "./ollama.js";
import { createOpenAiProvider } from "./openai.js";
import { createOpenRouterProvider } from "./openrouter.js";
import type { ChatProvider } from "./types.js";

export * from "./types.js";
export { AiSdkChatProvider } from "./ai-sdk-adapter.js";
export { createOpenAiProvider } from "./openai.js";
export { createAnthropicProvider } from "./anthropic.js";
export { createGoogleProvider } from "./google.js";
export { createOllamaProvider, DEFAULT_OLLAMA_BASE_URL, listOllamaModels } from "./ollama.js";
export { createOpenRouterProvider } from "./openrouter.js";
export { classifyProviderError, type ProviderErrorReason } from "./errorReason.js";

export type ProviderName = "openai" | "anthropic" | "google" | "ollama" | "openrouter";

export interface CreateProviderOptions {
  provider: ProviderName;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  /** `"subscription"` authenticates via an OAuth bearer token (`accessToken`) instead of `apiKey`. */
  authType?: "api_key" | "subscription";
  /** OAuth access token used when `authType` is `"subscription"`. */
  accessToken?: string;
  /**
   * Custom `fetch` for outbound provider requests. The desktop shell passes a Tauri-backed `fetch`
   * that relays through Rust to bypass webview CORS (provider APIs don't send CORS headers for the
   * app origin). Left `undefined` in the plain browser build to use the global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/** Single entry point for constructing a `ChatProvider` from a provider name + config. */
export function createProvider(options: CreateProviderOptions): ChatProvider {
  switch (options.provider) {
    case "openai":
      return createOpenAiProvider(options);
    case "anthropic":
      return createAnthropicProvider(options);
    case "google":
      return createGoogleProvider(options);
    case "ollama":
      return createOllamaProvider(options);
    case "openrouter":
      return createOpenRouterProvider(options);
    default: {
      const exhaustive: never = options.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
