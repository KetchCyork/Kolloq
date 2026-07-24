import { createOpenAI } from "@ai-sdk/openai";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider, ModelOption } from "./types.js";

export interface OpenAiProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS — see NEW-184). */
  fetchImpl?: typeof fetch;
}

export function createOpenAiProvider(config: OpenAiProviderConfig = {}): ChatProvider {
  const model = config.model ?? "gpt-4o-mini";
  const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL, fetch: config.fetchImpl });
  return new AiSdkChatProvider("openai", model, openai(model));
}

/** Non-chat model ids that OpenAI's `/v1/models` list includes alongside chat models (embeddings,
 * audio, image, moderation) — not useful in a chat-account model dropdown. */
const NON_CHAT_MODEL_PATTERN = /embedding|whisper|tts|dall-e|davinci|babbage|moderation/i;

export async function listOpenAiModels(config: OpenAiProviderConfig = {}): Promise<ModelOption[]> {
  if (!config.apiKey) {
    throw new Error("An API key is required to list OpenAI models.");
  }
  const baseURL = (config.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseURL}/models`, {
    headers: { authorization: `Bearer ${config.apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenAI model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as { data?: Array<{ id: string }> };
  return (body.data ?? [])
    .map((m) => ({ id: m.id }))
    .filter((m) => !NON_CHAT_MODEL_PATTERN.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}
