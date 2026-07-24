import { createAnthropicProvider, listAnthropicModels } from "./anthropic.js";
import { createGoogleProvider, listGoogleModels } from "./google.js";
import { createOllamaProvider, listOllamaModels } from "./ollama.js";
import { createOpenAiProvider, listOpenAiModels } from "./openai.js";
import { createOpenRouterProvider, listOpenRouterModels } from "./openrouter.js";
import type { ChatProvider, ModelOption } from "./types.js";

export * from "./types.js";
export { AiSdkChatProvider } from "./ai-sdk-adapter.js";
export { createOpenAiProvider, listOpenAiModels } from "./openai.js";
export { createAnthropicProvider, listAnthropicModels } from "./anthropic.js";
export { createGoogleProvider, listGoogleModels } from "./google.js";
export { createOllamaProvider, listOllamaModels } from "./ollama.js";
export { createOpenRouterProvider, listOpenRouterModels } from "./openrouter.js";

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
   * Custom `fetch` for outbound provider requests. Only the OpenAI factory currently reads this
   * (see NEW-184: `api.openai.com`'s chat endpoint doesn't send CORS headers for the app's origin,
   * unlike Anthropic/Google/OpenRouter, so it needs the desktop shell's Rust-backed relay `fetch`).
   * Left `undefined` in the plain browser build to use the global `fetch`.
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

/** Single entry point for listing a provider's currently available models, mirroring `createProvider`. */
export async function listModels(options: CreateProviderOptions): Promise<ModelOption[]> {
  switch (options.provider) {
    case "openai":
      return listOpenAiModels(options);
    case "anthropic":
      return listAnthropicModels(options);
    case "google":
      return listGoogleModels(options);
    case "ollama":
      return listOllamaModels(options);
    case "openrouter":
      return listOpenRouterModels(options);
    default: {
      const exhaustive: never = options.provider;
      throw new Error(`Unknown provider: ${String(exhaustive)}`);
    }
  }
}
