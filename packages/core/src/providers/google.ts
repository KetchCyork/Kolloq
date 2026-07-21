import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { AiSdkChatProvider } from "./ai-sdk-adapter.js";
import type { ChatProvider, ModelOption } from "./types.js";

export interface GoogleProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export function createGoogleProvider(config: GoogleProviderConfig = {}): ChatProvider {
  const model = config.model ?? "gemini-1.5-flash";
  const google = createGoogleGenerativeAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  return new AiSdkChatProvider("google", model, google(model));
}

export async function listGoogleModels(config: GoogleProviderConfig = {}): Promise<ModelOption[]> {
  if (!config.apiKey) {
    throw new Error("An API key is required to list Google models.");
  }
  const baseURL = (config.baseURL ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
  const url = new URL(`${baseURL}/models`);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("pageSize", "1000");

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Google model list request failed: ${response.status} ${response.statusText}`);
  }
  const body = (await response.json()) as {
    models?: Array<{ name: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  return (body.models ?? [])
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName }));
}
