import type { ChatAttachment, ChatMessage, ProviderName } from "@newvector/core";

export type { ChatAttachment };

export type { ProviderName };

/**
 * How an account authenticates. `api_key` is the original mode (a raw provider
 * key the user pastes). `subscription` uses an OAuth token captured from the
 * provider's login page, letting the user drive a paid plan (e.g. Claude
 * Pro/Max) instead of a metered API key.
 */
export type AccountAuthType = "api_key" | "subscription";

/** OAuth tokens captured from a provider's subscription login. These are secrets and are
 * routed to the OS keychain on desktop, same as `Account.apiKey`. */
export interface OAuthCredential {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when `accessToken` expires, if the provider returned an expiry. */
  expiresAt?: number;
  scope?: string;
}

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
  /** Defaults to `api_key` when absent (back-compat with accounts saved before subscriptions existed). */
  authType?: AccountAuthType;
  apiKey?: string;
  /** Present when `authType` is `subscription`. */
  oauth?: OAuthCredential;
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
  /** Resolved from the referenced account at turn time; see `resolveProviderConfig`. */
  authType?: AccountAuthType;
  accessToken?: string;
}

export interface AgentIdentity {
  name: string;
  color: string;
  emoji: string;
}

export interface StoredMessage extends ChatMessage {
  id: string;
  createdAt: number;
  /** Set when this turn failed outright (provider/network error) instead of producing a real reply —
   * rendered as a distinct error card rather than a normal assistant bubble. */
  error?: { reason: string; isConfigIssue: boolean };
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

/** Where a skill came from. Marketplace and URL sources from spec §7 aren't offered yet — there's no
 * catalog to browse and no CORS-safe fetch path — so installs are a pasted body or a local file. */
export type SkillSource = "pasted" | "local-file";

/**
 * An installed skill (spec §4/§7): a SKILL.md-style instruction package installed globally and
 * attached to individual agents. Attached + enabled skills are folded into the agent's system prompt
 * at turn time (see `composeAgentSystemPrompt`), so a skill changes behavior without editing personas.
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  /** The markdown body injected into attached agents' prompts. */
  instructions: string;
  source: SkillSource;
  /** File name for `local-file` installs, shown on the card so the user knows where it came from. */
  sourceLabel?: string;
  /** Off keeps the skill installed and attached but out of prompts. */
  enabled: boolean;
  /** `AgentSession` ids this skill is attached to. */
  attachedAgentIds: string[];
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
  /** True if the debate stopped early because estimated spend met or exceeded the session's
   * `budgetCap`, rather than reaching consensus or `maxRounds`. */
  budgetExceeded: boolean;
  /** The round cap actually in effect for this turn (the session's cap may change between turns). */
  maxRounds: number;
  dropped: CouncilDroppedMember[];
  answer: string;
  moderatorError?: string;
  totalCostNote: string;
  /** True when a human ended the debate early via Force vote, rather than it reaching consensus or
   * exhausting `maxRounds` on its own. */
  forcedVote: boolean;
}

/** In-progress (not yet persisted) transcript for a turn that's currently debating. */
export interface LiveCouncilTurn {
  question: string;
  rounds: CouncilMemberPosition[][];
  /** Round index of the most recent `round-start` event, for "round N of maxRounds" progress. */
  currentRound: number;
  maxRounds: number;
  dropped: CouncilDroppedMember[];
  consensusReached: boolean;
  budgetExceeded: boolean;
  answer?: string;
  moderatorError?: string;
  finished: boolean;
  /** True between a `paused` event and the following `resumed` event (see `CouncilController`). */
  paused: boolean;
  /** True once a `force-vote` event has landed — the debate is wrapping up early instead of running
   * further rounds. */
  forcedVote: boolean;
  /** The most recently applied `injected` event's message, shown as a brief acknowledgment — cleared
   * isn't necessary since a later injection (or none) simply replaces/keeps it for the rest of the turn. */
  lastInjectedMessage?: string;
}

export interface CouncilSession {
  id: string;
  identity: AgentIdentity;
  members: CouncilMemberConfig[];
  maxRounds?: number;
  /** Account that plays the (non-debating) moderator. Defaults to `members[0]`'s account when
   * unset, matching the council engine's own default — old sessions need no migration. */
  moderatorAccountId?: string;
  /** Budget cap in USD. Enforced as a hard stop by the debate engine's round loop, based on the
   * same client-side cost estimate the running-cost display uses (see costEstimate.ts) — real
   * per-request token usage isn't available, so this is an approximation, not a billing figure.
   * Undefined means no cap. */
  budgetCap?: number;
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

/** One agent assigned to a project's roster. Like a `CouncilMemberConfig`, it points at an
 * `Account` for the model/credentials, but also carries its own display identity (name/color)
 * since a roster member isn't tied to any single chat session's identity. */
export interface ProjectMemberConfig {
  id: string;
  accountId: string;
  identity: AgentIdentity;
  /** Optional one-line role shown under the name in the roster, e.g. "Writing & strategy". */
  role?: string;
}

export type ProjectTaskStatus = "todo" | "in_progress" | "done";

export interface ProjectTask {
  id: string;
  title: string;
  status: ProjectTaskStatus;
  /** Roster member id, if assigned. */
  assigneeId?: string;
  createdAt: number;
  updatedAt: number;
}

/** A project-knowledge file the user attached directly (as opposed to a file already sitting in
 * the connected working folder, which is listed live from the folder handle instead of stored here). */
export interface ProjectKnowledgeFile extends ChatAttachment {
  addedAt: number;
}

/** A working folder connected via the File System Access API. The handle itself (not JSON-safe,
 * and not something we want in export files) is persisted separately — see `projectFolders` in db.ts. */
export interface ProjectWorkingFolder {
  /** The folder's own name. The File System Access API does not expose the full OS path, so this
   * is the most specific location string a browser can honestly show. */
  name: string;
  connectedAt: number;
}

export interface ProjectChatMessage {
  id: string;
  role: "user" | "assistant";
  /** Roster member id that authored this message. Unset for user messages. */
  memberId?: string;
  content: string;
  attachments?: ChatAttachment[];
  error?: { reason: string; isConfigIssue: boolean };
  createdAt: number;
}

export interface Project {
  id: string;
  identity: AgentIdentity;
  workingFolder?: ProjectWorkingFolder;
  roster: ProjectMemberConfig[];
  tasks: ProjectTask[];
  knowledgeFiles: ProjectKnowledgeFile[];
  instructions: string;
  messages: ProjectChatMessage[];
  createdAt: number;
  updatedAt: number;
}
