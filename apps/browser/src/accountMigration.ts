import { PROVIDER_LABELS } from "./utils";
import { randomId, nowMs } from "./utils";
import type { Account, AgentSession } from "./types";

export interface MigrationResult {
  sessions: AgentSession[];
  accounts: Account[];
  /** Accounts that did not exist before this pass — persist these. */
  newAccounts: Account[];
  /** Session ids whose providerConfig changed — persist these. */
  changedSessionIds: Set<string>;
}

/**
 * Moves any session still carrying a raw `providerConfig.apiKey`/`baseURL` (the
 * shape used before the account model existed) onto a saved `Account`, reusing
 * an existing account when the provider/key/baseURL triple already matches one
 * so migrating N old sessions with the same key doesn't create N accounts.
 * Sessions with no key/baseURL to preserve (e.g. a fresh Ollama session) are
 * left unlinked rather than forced onto a synthetic account.
 */
export function migrateSessionsToAccounts(sessions: AgentSession[], existingAccounts: Account[]): MigrationResult {
  const accounts = [...existingAccounts];
  const newAccounts: Account[] = [];
  const changedSessionIds = new Set<string>();

  function findOrCreateAccount(config: AgentSession["providerConfig"]): Account {
    const { provider, apiKey, baseURL, model } = config;
    const match = accounts.find(
      (account) =>
        account.provider === provider &&
        (account.apiKey ?? undefined) === (apiKey ?? undefined) &&
        (account.baseURL ?? undefined) === (baseURL ?? undefined),
    );
    if (match) return match;

    const created: Account = {
      id: randomId(),
      provider,
      label: `${PROVIDER_LABELS[provider]} (migrated)`,
      model,
      apiKey,
      baseURL,
      createdAt: nowMs(),
    };
    accounts.push(created);
    newAccounts.push(created);
    return created;
  }

  const migratedSessions = sessions.map((session) => {
    const { provider, model, apiKey, baseURL, accountId } = session.providerConfig;
    if (accountId && accounts.some((account) => account.id === accountId)) return session;
    if (!apiKey && !baseURL) return session;

    const account = findOrCreateAccount(session.providerConfig);
    changedSessionIds.add(session.id);
    return {
      ...session,
      providerConfig: { provider, model, accountId: account.id },
    };
  });

  return { sessions: migratedSessions, accounts, newAccounts, changedSessionIds };
}
