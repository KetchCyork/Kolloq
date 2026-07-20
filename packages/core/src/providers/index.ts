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
export { createOllamaProvider } from "./ollama.js";
export { createOpenRouterProvider } from "./openrouter.js";

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
