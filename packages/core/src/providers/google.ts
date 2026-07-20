import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider } from "./types.js";

export interface GoogleProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** Custom `fetch` (desktop shell routes through Rust to bypass webview CORS). */
  fetchImpl?: typeof fetch;
}

export function createGoogleProvider(config: GoogleProviderConfig = {}): ChatProvider {
  const model = config.model ?? "gemini-1.5-flash";
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseURL, fetch: config.fetchImpl });
  return new AiSdkChatProvider("google", model, google(model));
}
