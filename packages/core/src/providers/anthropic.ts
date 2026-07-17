import { createAnthropic } from "@ai-sdk/anthropic";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface AnthropicProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export function createAnthropicProvider(config: AnthropicProviderConfig = {}): ChatProvider {
  const model = config.model ?? "claude-3-5-sonnet-20241022";
  const anthropic = createAnthropic({ apiKey: config.apiKey, baseURL: config.baseURL });
  return new AiSdkChatProvider("anthropic", model, anthropic(model));
}
