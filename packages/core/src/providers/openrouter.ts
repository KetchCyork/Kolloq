import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface OpenRouterProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * OpenRouter exposes an OpenAI-compatible endpoint (one key, hundreds of
 * hosted models), so we reuse the generic AI SDK provider instead of a
 * bespoke client, same as the Ollama adapter.
 */
export function createOpenRouterProvider(config: OpenRouterProviderConfig = {}): ChatProvider {
  const model = config.model ?? "openai/gpt-4o-mini";
  const openrouter = createOpenAICompatible({
    name: "openrouter",
    baseURL: config.baseURL ?? "https://openrouter.ai/api/v1",
    apiKey: config.apiKey,
  });
  return new AiSdkChatProvider("openrouter", model, openrouter(model));
}
