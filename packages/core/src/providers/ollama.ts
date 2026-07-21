import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface OllamaProviderConfig {
  baseURL?: string;
  model?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS). */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Ollama exposes an OpenAI-compatible endpoint, so we reuse that generic AI SDK
 * provider instead of a bespoke Ollama client. No API key needed for local use.
 */
export function createOllamaProvider(config: OllamaProviderConfig = {}): ChatProvider {
  const model = config.model ?? "llama3.1";
  const ollama = createOpenAICompatible({
    name: "ollama",
    baseURL: config.baseURL ?? DEFAULT_OLLAMA_BASE_URL,
    fetch: config.fetchImpl,
  });
  return new AiSdkChatProvider("ollama", model, ollama(model));
}

/**
 * Ollama's native (non-OpenAI-compatible) API exposes `GET /api/tags` for the models actually
 * pulled at an endpoint. The account form's base URL is the OpenAI-compatible one (conventionally
 * suffixed `/v1`), so this strips that off before hitting the native route.
 */
function tagsUrlFor(baseURL: string | undefined): string {
  const trimmed = (baseURL?.trim() || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const host = trimmed.replace(/\/v1$/, "");
  return `${host}/api/tags`;
}

interface OllamaTagsResponse {
  models?: Array<{ name?: string; model?: string }>;
}

/**
 * Queries an Ollama-compatible endpoint for the models actually installed there, so the account
 * form can offer real choices instead of a guessed default. Throws with a message safe to show the
 * user directly (network failure, non-2xx status, or malformed response).
 */
export async function listOllamaModels(baseURL: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const url = tagsUrlFor(baseURL);
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "GET", headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`Could not reach ${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status} ${res.statusText}`);
  }
  let data: OllamaTagsResponse;
  try {
    data = (await res.json()) as OllamaTagsResponse;
  } catch {
    throw new Error(`${url} did not return valid JSON — is this an Ollama-compatible endpoint?`);
  }
  const models = Array.isArray(data.models) ? data.models : [];
  return models
    .map((m) => m.name ?? m.model)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
}
