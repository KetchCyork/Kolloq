import type { Account, ProviderConfig } from "./types";

export type AgentStatus = "ready" | "error";

export interface AgentStatusInfo {
  status: AgentStatus;
  /** Short label for the status badge, e.g. "Ready" or "Connection error". */
  label: string;
  /** Longer explanation shown in the drawer/hint text; undefined when status is "ready". */
  detail?: string;
}

/**
 * Derives an agent's Ready/Connection-error badge from its provider config, same signal the spec
 * (§5.2) describes: "if an agent's underlying connection breaks, the agent shows an error badge
 * everywhere it appears and cannot be invoked until fixed." Mirrors the credential checks
 * `resolveProviderConfig`/`AccountsManager` already apply at send time, just without a network call.
 */
export function getAgentStatus(providerConfig: ProviderConfig, accounts: Account[]): AgentStatusInfo {
  if (providerConfig.accountId) {
    const account = accounts.find((candidate) => candidate.id === providerConfig.accountId);
    if (!account) {
      return { status: "error", label: "Connection error", detail: "Its connection was removed — pick another." };
    }
    if (account.authType === "subscription") {
      if (!account.oauth?.accessToken) {
        return { status: "error", label: "Connection error", detail: "Subscription sign-in expired — reconnect it." };
      }
      return { status: "ready", label: "Ready" };
    }
    // Ollama runs against a local endpoint and never has an API key — that's expected, not an error.
    if (!account.apiKey && account.provider !== "ollama") {
      return { status: "error", label: "Connection error", detail: "Its API key is missing — replace it." };
    }
    return { status: "ready", label: "Ready" };
  }

  if (providerConfig.apiKey || providerConfig.authType === "subscription" || providerConfig.provider === "ollama") {
    return { status: "ready", label: "Ready" };
  }

  return { status: "error", label: "No connection", detail: "Pick a connection before this agent can run." };
}
