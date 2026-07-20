import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface OllamaProviderConfig {
  baseURL?: string;
  model?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS). */
  fetchImpl?: typeof fetch;
}

/**
 * Ollama exposes an OpenAI-compatible endpoint, so we reuse that generic AI SDK
 * provider instead of a bespoke Ollama client. No API key needed for local use.
 */
export function createOllamaProvider(config: OllamaProviderConfig = {}): ChatProvider {
  const model = config.model ?? "llama3.1";
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: config.baseURL ?? "http://localhost:11434/v1",
    fetch: config.fetchImpl,
  });
  return new AiSdkChatProvider("ollama", model, ollama(model));
}
