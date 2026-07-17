import type { ChatMessage, ProviderName } from "@newvector/core";

export type { ProviderName };

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
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
