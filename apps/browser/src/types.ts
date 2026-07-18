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

export interface SessionExportFile {
  format: "newvector-cowork-sessions";
  version: 1;
  exportedAt: number;
  sessions: AgentSession[];
}
