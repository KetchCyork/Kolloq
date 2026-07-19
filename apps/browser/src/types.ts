import type { ChatAttachment, ChatMessage, ProviderName } from "@newvector/core";

export type { ChatAttachment };

export type { ProviderName };

/**
 * A saved, named credential for a provider (e.g. "Work OpenAI key"). Sessions
 * reference an account by id instead of embedding a raw key, so one account
 * can back multiple sessions and shows up once in the model picker.
 */
export interface Account {
  id: string;
  provider: ProviderName;
  label: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  createdAt: number;
}

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  /** Preferred going forward: references an `Account` for credentials/baseURL. */
  accountId?: string;
  /**
   * Legacy fields from before the account model existed. Still read so
   * un-migrated sessions keep working; new sessions should use `accountId`.
   */
  apiKey?: string;
  baseURL?: string;
}

export interface AgentIdentity {
  name: string;
  color: string;
  emoji: string;
}

export interface StoredMessage extends ChatMessage {
  id: string;
  createdAt: number;
}

export interface AgentSession {
  id: string;
  identity: AgentIdentity;
  providerConfig: ProviderConfig;
  systemPrompt: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

/** One seat on an Advisory Council session. Each member is its own account (and therefore its own
 * provider/model), unlike a single-agent session's one `providerConfig`. */
export interface CouncilMemberConfig {
  id: string;
  accountId: string;
  /** Optional persona/role label surfaced in prompts and the transcript, e.g. "skeptic". */
  role?: string;
}

export type CouncilStance = "concur" | "dissent";

/** One member's contribution in one round, with a display label resolved from its account and a
 * client-side cost estimate (no provider returns real usage, so this is always an approximation). */
export interface CouncilMemberPosition {
  memberId: string;
  label: string;
  role?: string;
  content: string;
  stance?: CouncilStance;
  reason?: string;
  costNote: string;
}

export interface CouncilDroppedMember {
  memberId: string;
  label: string;
  round: number;
  error: string;
}

/** One complete debate: a question asked to the council, its round-by-round transcript, and the
 * moderator's final synthesized answer. A council session can accumulate many turns over time. */
export interface CouncilTurn {
  id: string;
  question: string;
  createdAt: number;
  rounds: CouncilMemberPosition[][];
  consensusReached: boolean;
  finalRound: number;
  dropped: CouncilDroppedMember[];
  answer: string;
  moderatorError?: string;
  totalCostNote: string;
}

/** In-progress (not yet persisted) transcript for a turn that's currently debating. */
export interface LiveCouncilTurn {
  question: string;
  rounds: CouncilMemberPosition[][];
  dropped: CouncilDroppedMember[];
  consensusReached: boolean;
  answer?: string;
  moderatorError?: string;
  finished: boolean;
}

export interface CouncilSession {
  id: string;
  identity: AgentIdentity;
  members: CouncilMemberConfig[];
  maxRounds?: number;
  turns: CouncilTurn[];
  createdAt: number;
  updatedAt: number;
}

export interface SessionExportFile {
  format: "newvector-cowork-sessions";
  version: 1;
  exportedAt: number;
  sessions: AgentSession[];
  /** Absent in exports produced before council sessions existed; treat as empty on import. */
  councilSessions?: CouncilSession[];
}
