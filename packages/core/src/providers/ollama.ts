import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider, ModelOption } from "./types.js";

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

/**
 * Lists models pulled into the local Ollama instance via its native `/api/tags` endpoint
 * (not the OpenAI-compatible `/v1` surface `createOllamaProvider` uses for chat, which has no
 * model-listing equivalent).
 */
export async function listOllamaModels(config: OllamaProviderConfig = {}): Promise<ModelOption[]> {
  const configuredBase = config.baseURL ?? "http://localhost:11434/v1";
  const root = configuredBase.replace(/\/v1\/?$/, "");

  const response = await fetch(`${root}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    models?: Array<{ name?: string; model?: string; capabilities?: string[] }>;
  };
  return (body.models ?? [])
    // Local Ollama installs often also have embedding-only models pulled (e.g. for RAG use
    // elsewhere in the app); those can't hold a chat conversation, so exclude them when the
    // daemon reports capabilities. Older Ollama versions omit `capabilities` — keep those models
    // rather than risk hiding everything.
    .filter((m) => !m.capabilities || m.capabilities.includes("completion"))
    .map((m) => m.name ?? m.model)
    .filter((id): id is string => !!id)
    .map((id) => ({ id }));
}
