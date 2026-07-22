import type { AgentIdentity, CouncilSession, ProviderName } from "./types";

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai", "google", "ollama", "openrouter"];

export const PROVIDER_DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-3-5-sonnet-20241022",
  openai: "gpt-4o-mini",
  google: "gemini-1.5-flash",
  ollama: "llama3.1",
  openrouter: "openai/gpt-4o-mini",
};

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
  return crypto.randomUUID();
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

// Councils are numbered independently of agents so the sidebar reads "Council 1, Council 2".
export function councilIdentity(existingCouncilCount: number): AgentIdentity {
  const index = existingCouncilCount % IDENTITY_COLORS.length;
  return {
    name: `Council ${existingCouncilCount + 1}`,
    color: IDENTITY_COLORS[index],
    emoji: "\u{1F3DB}\u{FE0F}",
  };
}

// Councils created before they had their own naming were stored as "Agent N". Renumber those
// in place (oldest first) so existing sidebars read "Council 1, Council 2" too.
export function renameLegacyCouncilIdentities(councilSessions: CouncilSession[]): {
  sessions: CouncilSession[];
  changedIds: Set<string>;
} {
  const positionById = new Map<string, number>();
  [...councilSessions]
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((session, index) => positionById.set(session.id, index + 1));

  const changedIds = new Set<string>();
  const sessions = councilSessions.map((session) => {
    if (!/^Agent \d+$/.test(session.identity.name)) return session;
    changedIds.add(session.id);
    return { ...session, identity: { ...session.identity, name: `Council ${positionById.get(session.id)}` } };
  });
  return { sessions, changedIds };
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
