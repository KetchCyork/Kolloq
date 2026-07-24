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

const AUTO_COUNCIL_NAME = /^Council \d+$/;

/** True while a council still carries the placeholder name we generated for it, i.e. the user has
 * never renamed it and we are free to title it from what the council is actually about. */
export function isAutoCouncilName(name: string): boolean {
  return AUTO_COUNCIL_NAME.test(name.trim());
}

/** Condense a council's founding question into a sidebar-sized title. No ellipsis: the result is
 * persisted as the council's name and shown in the rename field, so it has to read as a name. The
 * sidebar's own text-overflow rule handles anything still too wide for the column. */
export function shortCouncilTitle(question: string, maxLength = 34): string {
  const collapsed = question.replace(/\s+/g, " ").trim();
  const trimPunctuation = (value: string) => value.replace(/[\s?.,;:!-]+$/, "");
  if (collapsed.length <= maxLength) return trimPunctuation(collapsed);
  const clipped = collapsed.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  // Only fall back to a mid-word cut when the first "word" is longer than the whole budget.
  return trimPunctuation(lastSpace > maxLength / 2 ? clipped.slice(0, lastSpace) : clipped);
}

/** Give every still-untitled council that has been asked something a title drawn from its first
 * question. Councils the user renamed, and councils that have never run a turn, are left alone. */
export function titleUntitledCouncils(councilSessions: CouncilSession[]): {
  sessions: CouncilSession[];
  changedIds: Set<string>;
} {
  const changedIds = new Set<string>();
  const sessions = councilSessions.map((session) => {
    if (!isAutoCouncilName(session.identity.name)) return session;
    const firstQuestion = session.turns[0]?.question;
    if (!firstQuestion?.trim()) return session;
    const name = shortCouncilTitle(firstQuestion);
    if (!name) return session;
    changedIds.add(session.id);
    return { ...session, identity: { ...session.identity, name } };
  });
  return { sessions, changedIds };
}

/** The council's primary line in the sidebar. Titled councils read "Council: <topic>" so a council
 * row is still distinguishable from an agent row at a glance; placeholder names already say
 * "Council N" and are left unprefixed. */
export function councilListTitle(session: CouncilSession): string {
  const name = session.identity.name.trim() || "Council";
  return /^council\b/i.test(name) ? name : `Council: ${name}`;
}

/** The council's secondary line in the sidebar: seat count plus where the debate landed. */
export function councilListSubtitle(session: CouncilSession, isLive: boolean): string {
  const seats = `${session.members.length} agent${session.members.length === 1 ? "" : "s"}`;
  if (isLive) return `${seats} · Debating…`;
  const lastTurn = session.turns.at(-1);
  if (!lastTurn) return `${seats} · Not started`;
  return `${seats} · ${lastTurn.consensusReached ? "Consensus" : "No consensus"}`;
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
