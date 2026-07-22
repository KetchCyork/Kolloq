import type { AgentIdentity, ProviderName } from "./types";

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai", "google", "ollama", "openrouter"];

export const PROVIDER_DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o-mini",
  google: "gemini-1.5-flash",
  ollama: "llama3.1",
  openrouter: "openai/gpt-4o-mini",
};

// Same-origin path proxied (see vite.config.ts's `ollamaProxy`) to the local Ollama daemon, so the
// browser never has to cross-origin-fetch it directly and hit Ollama's own CORS allowlist — which
// rejects anything but a localhost Origin, breaking this over a tailnet IP/hostname preview. Must be
// an absolute URL (not just the path): the AI SDK's OpenAI-compatible client builds request URLs
// with `new URL(baseURL + path)`, which throws on a bare relative path with no base to resolve against.
export const DEFAULT_OLLAMA_BASE_URL =
  typeof window !== "undefined" ? `${window.location.origin}/__ollama__/v1` : "/__ollama__/v1";

export const PROVIDER_LABELS: Record<ProviderName, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google Gemini",
  ollama: "Ollama (local)",
  openrouter: "OpenRouter",
};

const IDENTITY_COLORS = ["#6366f1", "#0891b2", "#c026d3", "#d97706", "#059669", "#dc2626", "#4f46e5"];
const IDENTITY_EMOJIS = ["\u{1F916}", "\u{1F9E0}", "\u{1F9ED}", "\u{1F52E}", "\u{1F680}", "\u{1F98A}", "\u{1F41D}"];

export function randomId(): string {
  // `crypto.randomUUID` requires a secure context (HTTPS or localhost). This app is also served
  // over plain HTTP on tailnet IP/hostname origins (see NEW-63's preview `allowedHosts`), which
  // are not secure contexts — calling it there throws and, since every session/account/message id
  // goes through this function, takes down any click handler that creates one (e.g. "New council").
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function nowMs(): number {
  return Date.now();
}

export function randomIdentity(existingCount: number): AgentIdentity {
  const index = existingCount % IDENTITY_COLORS.length;
  return {
    name: `Agent ${existingCount + 1}`,
    color: IDENTITY_COLORS[index],
    emoji: IDENTITY_EMOJIS[index],
  };
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
