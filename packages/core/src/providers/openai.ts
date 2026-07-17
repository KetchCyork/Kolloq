import { createOpenAI } from "@ai-sdk/openai";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface OpenAiProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export function createOpenAiProvider(config: OpenAiProviderConfig = {}): ChatProvider {
  const model = config.model ?? "gpt-4o-mini";
  const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return new AiSdkChatProvider("openai", model, openai(model));
}
