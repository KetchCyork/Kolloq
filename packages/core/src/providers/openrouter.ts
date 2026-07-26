import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider, ModelOption } from "./types.js";

export interface OpenRouterProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS). */
  fetchImpl?: typeof fetch;
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
    fetch: config.fetchImpl,
  });
  return new AiSdkChatProvider("openrouter", model, openrouter(model));
}

/** OpenRouter's model catalog is public — no API key required to list it. */
export async function listOpenRouterModels(config: OpenRouterProviderConfig = {}): Promise<ModelOption[]> {
  const baseURL = (config.baseURL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const response = await fetch(`${baseURL}/models`);
  if (!response.ok) {
    throw new Error(`OpenRouter model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { data?: Array<{ id: string; name?: string }> };
  return (body.data ?? []).map((m) => ({ id: m.id, label: m.name }));
}
