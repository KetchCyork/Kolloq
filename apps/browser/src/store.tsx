import type { AgentEvent, ChatAttachment, CouncilEvent, ToolCall } from "@newvector/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getToolCount, runSessionTurn } from "./agentClient";
import { runCouncilTurn } from "./councilClient";
import { applyCouncilEvent, computeTotalCostNote, initialLiveCouncilTurn, validateCouncilMembers } from "./councilReducer";
import {
  accountCredentialKey,
  accountOAuthKey,
  deleteApiKey,
  isTauriRuntime,
  loadApiKey,
  saveApiKey,
} from "./credentials";
import {
  deleteAccount as deleteAccountRecord,
  deleteCouncilSession as deleteCouncilSessionRecord,
  loadAllAccounts,
  loadAllCouncilSessions,
  loadAllSessions,
  putAccount,
  putAllCouncilSessions,
  putAllSessions,
  putCouncilSession,
  putSession,
  deleteSession as deleteSessionRecord,
} from "./db";
import { migrateSessionsToAccounts } from "./accountMigration";
import { applyTheme, loadPreferences, savePreferences, type Preferences } from "./preferences";
import { isOAuthCredentialExpiring, refreshSubscriptionAuth } from "./subscriptionAuth";
import { capture, setTelemetryEnabled } from "./telemetry";
import type {
  Account,
  AgentSession,
  CouncilMemberConfig,
  CouncilSession,
  CouncilTurn,
  LiveCouncilTurn,
  OAuthCredential,
  ProviderConfig,
  SessionExportFile,
  StoredMessage,
} from "./types";
import { councilIdentity, nowMs, randomId, randomIdentity, renameLegacyCouncilIdentities } from "./utils";

/**
 * Persists a session, routing its API key to the OS keychain instead of
 * IndexedDB when running inside the Tauri desktop shell so the key never
 * touches disk in plaintext.
 */
async function persistSession(session: AgentSession): Promise<void> {
  if (!isTauriRuntime()) {
    await putSession(session);
    return;
  }
  const { apiKey, ...restConfig } = session.providerConfig;
  if (apiKey) {
    await saveApiKey(session.id, apiKey);
  } else {
    await deleteApiKey(session.id);
  }
  await putSession({ ...session, providerConfig: restConfig });
}

async function hydrateSession(session: AgentSession): Promise<AgentSession> {
  if (!isTauriRuntime()) return session;
  const apiKey = await loadApiKey(session.id);
  return apiKey ? { ...session, providerConfig: { ...session.providerConfig, apiKey } } : session;
}

/** Same keychain-routing pattern as `persistSession`/`hydrateSession`, keyed by account id instead of session id. */
async function persistAccount(account: Account): Promise<void> {
  if (!isTauriRuntime()) {
    await putAccount(account);
    return;
  }
  const { apiKey, oauth, ...rest } = account;
  if (apiKey) {
    await saveApiKey(accountCredentialKey(account.id), apiKey);
  } else {
    await deleteApiKey(accountCredentialKey(account.id));
  }
  if (oauth) {
    await saveApiKey(accountOAuthKey(account.id), JSON.stringify(oauth));
  } else {
    await deleteApiKey(accountOAuthKey(account.id));
  }
  await putAccount(rest);
}

async function hydrateAccount(account: Account): Promise<Account> {
  if (!isTauriRuntime()) return account;
  const [apiKey, oauthRaw] = await Promise.all([
    loadApiKey(accountCredentialKey(account.id)),
    loadApiKey(accountOAuthKey(account.id)),
  ]);
  let hydrated = account;
  if (apiKey) hydrated = { ...hydrated, apiKey };
  if (oauthRaw) {
    try {
      hydrated = { ...hydrated, oauth: JSON.parse(oauthRaw) as OAuthCredential };
    } catch {
      // Corrupt keychain entry — treat as no stored subscription token.
    }
  }
  return hydrated;
}

/** Resolves a session's effective provider config, pulling credentials/baseURL from its saved account when it has one. */
function resolveProviderConfig(config: ProviderConfig, accounts: Account[]): ProviderConfig {
  if (!config.accountId) return config;
  const account = accounts.find((candidate) => candidate.id === config.accountId);
  if (!account) return config;
  if (account.authType === "subscription") {
    return { ...config, authType: "subscription", accessToken: account.oauth?.accessToken, baseURL: account.baseURL };
  }
  return { ...config, apiKey: account.apiKey, baseURL: account.baseURL };
}

export interface LiveToolCall {
  call: ToolCall;
  status: "running" | "done" | "error";
  result?: unknown;
  /** Set when this call came from a delegated sub-agent, so the step tracker can indent/label it. */
  agentName?: string;
  depth?: number;
}

export interface LiveTurn {
  text: string;
  toolCalls: LiveToolCall[];
  error?: string;
}

interface StoreState {
  sessions: AgentSession[];
  councilSessions: CouncilSession[];
  accounts: Account[];
  activeSessionId: string | null;
  live: Record<string, LiveTurn>;
  councilLive: Record<string, LiveCouncilTurn>;
  ready: boolean;
  accountsManagerOpen: boolean;
  preferences: Preferences;
  preferencesOpen: boolean;
}

interface StoreApi extends StoreState {
  setActiveSessionId: (id: string) => void;
  createSession: () => AgentSession;
  updateSession: (id: string, patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => void;
  deleteSession: (id: string) => void;
  sendMessage: (sessionId: string, text: string, attachments?: ChatAttachment[]) => Promise<void>;
  createCouncilSession: (members: Array<Omit<CouncilMemberConfig, "id">>) => CouncilSession;
  updateCouncilSession: (
    id: string,
    patch: Partial<Pick<CouncilSession, "identity" | "members" | "maxRounds">>,
  ) => void;
  deleteCouncilSession: (id: string) => void;
  askCouncil: (sessionId: string, question: string) => Promise<void>;
  exportSessions: () => SessionExportFile;
  importSessions: (data: SessionExportFile, mode: "merge" | "replace") => Promise<void>;
  createAccount: (input: Omit<Account, "id" | "createdAt">) => Account;
  updateAccount: (id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => void;
  deleteAccount: (id: string) => void;
  openAccountsManager: () => void;
  closeAccountsManager: () => void;
  updatePreferences: (patch: Partial<Preferences>) => void;
  openPreferences: () => void;
  closePreferences: () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [councilSessions, setCouncilSessions] = useState<CouncilSession[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveTurn>>({});
  const [councilLive, setCouncilLive] = useState<Record<string, LiveCouncilTurn>>({});
  const [ready, setReady] = useState(false);
  const [accountsManagerOpen, setAccountsManagerOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const sessionsRef = useRef<AgentSession[]>([]);
  sessionsRef.current = sessions;
  const councilSessionsRef = useRef<CouncilSession[]>([]);
  councilSessionsRef.current = councilSessions;
  const accountsRef = useRef<Account[]>([]);
  accountsRef.current = accounts;
  const preferencesRef = useRef<Preferences>(preferences);
  preferencesRef.current = preferences;
  const initStarted = useRef(false);

  useEffect(() => {
    setTelemetryEnabled(preferences.telemetryEnabled);
  }, [preferences.telemetryEnabled]);

  useEffect(() => {
    applyTheme(preferences.theme);
    if (preferences.theme !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => applyTheme(preferences.theme);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preferences.theme]);

  useEffect(() => {
    if (initStarted.current) return;
    initStarted.current = true;

    async function init() {
      const [loadedSessions, loadedAccounts, loadedCouncilSessions] = await Promise.all([
        loadAllSessions(),
        loadAllAccounts(),
        loadAllCouncilSessions(),
      ]);
      const [hydratedSessions, hydratedAccounts] = await Promise.all([
        Promise.all(loadedSessions.map(hydrateSession)),
        Promise.all(loadedAccounts.map(hydrateAccount)),
      ]);

      const migration = migrateSessionsToAccounts(hydratedSessions, hydratedAccounts);
      await Promise.all(migration.newAccounts.map(persistAccount));
      await Promise.all(
        migration.sessions.filter((session) => migration.changedSessionIds.has(session.id)).map(persistSession),
      );

      setSessions(migration.sessions);
      setAccounts(migration.accounts);
      // Councils created before they had their own naming were stored as "Agent N"; rename them.
      const councilMigration = renameLegacyCouncilIdentities(loadedCouncilSessions);
      await Promise.all(
        councilMigration.sessions
          .filter((session) => councilMigration.changedIds.has(session.id))
          .map(putCouncilSession),
      );
      setCouncilSessions(councilMigration.sessions);
      setActiveSessionId((current) => current ?? migration.sessions[0]?.id ?? councilMigration.sessions[0]?.id ?? null);
      setReady(true);
    }
    void init();
  }, []);

  const createSession = useCallback((): AgentSession => {
    const defaultAccount = accountsRef.current[0];
    const prefs = preferencesRef.current;
    const providerConfig = defaultAccount
      ? { provider: defaultAccount.provider, model: defaultAccount.model, accountId: defaultAccount.id }
      : { provider: prefs.defaultProvider, model: prefs.defaultModel };
    const session: AgentSession = {
      id: randomId(),
      identity: randomIdentity(sessionsRef.current.length),
      providerConfig,
      systemPrompt: "You are a helpful assistant.",
      messages: [],
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    setSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    void persistSession(session);
    capture({ type: "session_created", provider: providerConfig.provider });
    return session;
  }, []);

  const createAccount = useCallback((input: Omit<Account, "id" | "createdAt">): Account => {
    const account: Account = { ...input, id: randomId(), createdAt: nowMs() };
    setAccounts((prev) => [...prev, account]);
    void persistAccount(account);
    return account;
  }, []);

  const updateAccount = useCallback((id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => {
    setAccounts((prev) =>
      prev.map((account) => {
        if (account.id !== id) return account;
        const updated = { ...account, ...patch };
        void persistAccount(updated);
        return updated;
      }),
    );
  }, []);

  /**
   * Refreshes a subscription account's OAuth token when it's expired (or about to), persisting the
   * new token and returning the up-to-date account. Returns the account unchanged for API-key
   * accounts, accounts with a still-valid token, or accounts with no refresh token to fall back on.
   * Refresh failures (e.g. a revoked grant) are swallowed here — the stale token is used as-is and
   * the resulting provider call surfaces its own auth error, same as any other request failure.
   */
  const refreshAccountIfNeeded = useCallback(async (account: Account): Promise<Account> => {
    if (account.authType !== "subscription" || !account.oauth?.refreshToken) return account;
    if (!isOAuthCredentialExpiring(account.oauth)) return account;
    try {
      const oauth = await refreshSubscriptionAuth(account.provider, account.oauth.refreshToken);
      const updated: Account = { ...account, oauth };
      setAccounts((prev) => prev.map((candidate) => (candidate.id === account.id ? updated : candidate)));
      void persistAccount(updated);
      return updated;
    } catch {
      return account;
    }
  }, []);

  const deleteAccountById = useCallback((id: string) => {
    setAccounts((prev) => prev.filter((account) => account.id !== id));
    void deleteAccountRecord(id);
    if (isTauriRuntime()) void deleteApiKey(accountCredentialKey(id));
  }, []);

  const updateSession = useCallback(
    (id: string, patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== id) return session;
          const updated = { ...session, ...patch, updatedAt: nowMs() };
          void persistSession(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const deleteSessionById = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((session) => session.id !== id));
      void deleteSessionRecord(id);
      if (isTauriRuntime()) void deleteApiKey(id);
      setActiveSessionId((current) => {
        if (current !== id) return current;
        const remaining = sessionsRef.current.filter((session) => session.id !== id);
        return remaining[0]?.id ?? null;
      });
    },
    [],
  );

  const appendMessages = useCallback((sessionId: string, messages: StoredMessage[]) => {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const updated = { ...session, messages: [...session.messages, ...messages], updatedAt: nowMs() };
        void persistSession(updated);
        return updated;
      }),
    );
  }, []);

  const sendMessage = useCallback(
    async (sessionId: string, text: string, attachments?: ChatAttachment[]) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
      if (!session) return;

      const priorMessages = session.messages;
      const userMessage: StoredMessage = {
        id: randomId(),
        createdAt: nowMs(),
        role: "user",
        content: text,
        ...(attachments?.length ? { attachments } : {}),
      };
      appendMessages(sessionId, [userMessage]);
      setLive((prev) => ({ ...prev, [sessionId]: { text: "", toolCalls: [] } }));
      capture({ type: "message_sent", provider: session.providerConfig.provider, toolCount: getToolCount() });

      const onEvent = (event: AgentEvent) => {
        if (event.type === "tool-call") {
          capture({ type: "tool_call", toolName: event.toolCall.name });
        }
        if (event.type === "error") {
          // AgentRunner emits this both for stream/provider failures and for tool execution
          // failures; there's no discriminator on the event, so this is a best-effort label.
          capture({ type: "provider_error", provider: session.providerConfig.provider });
        }
        setLive((prev) => {
          const turn = prev[sessionId] ?? { text: "", toolCalls: [] };
          if (event.type === "text-delta") {
            return { ...prev, [sessionId]: { ...turn, text: turn.text + event.delta } };
          }
          if (event.type === "tool-call") {
            return {
              ...prev,
              [sessionId]: { ...turn, toolCalls: [...turn.toolCalls, { call: event.toolCall, status: "running" }] },
            };
          }
          if (event.type === "tool-result") {
            return {
              ...prev,
              [sessionId]: {
                ...turn,
                toolCalls: turn.toolCalls.map((tc) =>
                  tc.call.id === event.toolCall.id ? { ...tc, status: "done", result: event.result } : tc,
                ),
              },
            };
          }
          if (event.type === "error") {
            return { ...prev, [sessionId]: { ...turn, error: event.error.message } };
          }
          return prev;
        });
      };

      try {
        let accountsForTurn = accountsRef.current;
        const accountId = session.providerConfig.accountId;
        const account = accountId ? accountsForTurn.find((candidate) => candidate.id === accountId) : undefined;
        if (account) {
          const fresh = await refreshAccountIfNeeded(account);
          if (fresh !== account) {
            accountsForTurn = accountsForTurn.map((candidate) => (candidate.id === accountId ? fresh : candidate));
          }
        }
        const effectiveSession = {
          ...session,
          providerConfig: resolveProviderConfig(session.providerConfig, accountsForTurn),
        };
        const turn = await runSessionTurn(effectiveSession, priorMessages, text, attachments, onEvent);
        const storedTurn: StoredMessage[] = turn.map((message) => ({ ...message, id: randomId(), createdAt: nowMs() }));
        appendMessages(sessionId, storedTurn);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        capture({ type: "provider_error", provider: session.providerConfig.provider });
        appendMessages(sessionId, [
          { id: randomId(), createdAt: nowMs(), role: "assistant", content: `⚠️ ${message}` },
        ]);
      } finally {
        setLive((prev) => {
          const next = { ...prev };
          delete next[sessionId];
          return next;
        });
      }
    },
    [appendMessages],
  );

  const createCouncilSession = useCallback((members: Array<Omit<CouncilMemberConfig, "id">>): CouncilSession => {
    const session: CouncilSession = {
      id: randomId(),
      identity: councilIdentity(councilSessionsRef.current.length),
      members: members.map((member) => ({ ...member, id: randomId() })),
      turns: [],
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    setCouncilSessions((prev) => [...prev, session]);
    setActiveSessionId(session.id);
    void putCouncilSession(session);
    return session;
  }, []);

  const updateCouncilSession = useCallback(
    (id: string, patch: Partial<Pick<CouncilSession, "identity" | "members" | "maxRounds">>) => {
      setCouncilSessions((prev) =>
        prev.map((session) => {
          if (session.id !== id) return session;
          const updated = { ...session, ...patch, updatedAt: nowMs() };
          void putCouncilSession(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const deleteCouncilSessionById = useCallback((id: string) => {
    setCouncilSessions((prev) => prev.filter((session) => session.id !== id));
    void deleteCouncilSessionRecord(id);
    setActiveSessionId((current) => {
      if (current !== id) return current;
      const remainingCouncil = councilSessionsRef.current.filter((session) => session.id !== id);
      return sessionsRef.current[0]?.id ?? remainingCouncil[0]?.id ?? null;
    });
  }, []);

  const askCouncil = useCallback(async (sessionId: string, question: string) => {
    const session = councilSessionsRef.current.find((candidate) => candidate.id === sessionId);
    if (!session) return;

    const validationError = validateCouncilMembers(session.members, accountsRef.current);
    if (validationError) throw new Error(validationError);

    let accountsForTurn = accountsRef.current;
    for (const memberAccountId of new Set(session.members.map((member) => member.accountId))) {
      const account = accountsForTurn.find((candidate) => candidate.id === memberAccountId);
      if (!account) continue;
      const fresh = await refreshAccountIfNeeded(account);
      if (fresh !== account) {
        accountsForTurn = accountsForTurn.map((candidate) => (candidate.id === memberAccountId ? fresh : candidate));
      }
    }

    let liveTurn: LiveCouncilTurn = initialLiveCouncilTurn(question);
    setCouncilLive((prev) => ({ ...prev, [sessionId]: liveTurn }));

    const onEvent = (event: CouncilEvent) => {
      liveTurn = applyCouncilEvent(liveTurn, event, session.members, accountsRef.current);
      setCouncilLive((prev) => ({ ...prev, [sessionId]: liveTurn }));
    };

    try {
      await runCouncilTurn(session.members, accountsForTurn, session.maxRounds, question, onEvent);
    } catch (error) {
      // Council.run() itself never rejects (member/moderator errors surface as events); this only
      // fires for setup failures, e.g. a member's account was removed after validation passed.
      const message = error instanceof Error ? error.message : String(error);
      liveTurn = { ...liveTurn, moderatorError: liveTurn.moderatorError ?? message, finished: true };
    } finally {
      setCouncilLive((prev) => {
        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
      if (liveTurn.finished) {
        const turnRecord: CouncilTurn = {
          id: randomId(),
          question: liveTurn.question,
          createdAt: nowMs(),
          rounds: liveTurn.rounds,
          consensusReached: liveTurn.consensusReached,
          finalRound: Math.max(0, liveTurn.rounds.length - 1),
          dropped: liveTurn.dropped,
          answer: liveTurn.answer ?? "",
          moderatorError: liveTurn.moderatorError,
          totalCostNote: computeTotalCostNote(liveTurn.rounds, liveTurn.answer, session.members, accountsRef.current),
        };
        setCouncilSessions((prev) =>
          prev.map((candidate) => {
            if (candidate.id !== sessionId) return candidate;
            const updated = { ...candidate, turns: [...candidate.turns, turnRecord], updatedAt: nowMs() };
            void putCouncilSession(updated);
            return updated;
          }),
        );
      }
    }
  }, []);

  const exportSessions = useCallback((): SessionExportFile => {
    return {
      format: "newvector-cowork-sessions",
      version: 1,
      exportedAt: nowMs(),
      sessions: sessionsRef.current,
      councilSessions: councilSessionsRef.current,
    };
  }, []);

  const importSessions = useCallback(async (data: SessionExportFile, mode: "merge" | "replace") => {
    if (data.format !== "newvector-cowork-sessions") {
      throw new Error("Unrecognized export file format.");
    }
    const incoming = data.sessions;
    const incomingCouncil = data.councilSessions ?? [];
    const nextSessions = mode === "replace" ? incoming : mergeSessions(sessionsRef.current, incoming);
    const nextCouncilSessions =
      mode === "replace" ? incomingCouncil : mergeCouncilSessions(councilSessionsRef.current, incomingCouncil);
    setSessions(nextSessions);
    setCouncilSessions(nextCouncilSessions);
    setActiveSessionId((current) => current ?? nextSessions[0]?.id ?? nextCouncilSessions[0]?.id ?? null);
    if (isTauriRuntime()) {
      await Promise.all(incoming.map(persistSession));
    } else {
      await putAllSessions(incoming);
    }
    await putAllCouncilSessions(incomingCouncil);
  }, []);

  const updatePreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((prev) => {
      const updated = { ...prev, ...patch, keybindings: { ...prev.keybindings, ...patch.keybindings } };
      savePreferences(updated);
      return updated;
    });
  }, []);

  const value = useMemo<StoreApi>(
    () => ({
      sessions,
      councilSessions,
      accounts,
      activeSessionId,
      live,
      councilLive,
      ready,
      accountsManagerOpen,
      preferences,
      preferencesOpen,
      setActiveSessionId,
      createSession,
      updateSession,
      deleteSession: deleteSessionById,
      sendMessage,
      createCouncilSession,
      updateCouncilSession,
      deleteCouncilSession: deleteCouncilSessionById,
      askCouncil,
      exportSessions,
      importSessions,
      createAccount,
      updateAccount,
      deleteAccount: deleteAccountById,
      openAccountsManager: () => setAccountsManagerOpen(true),
      closeAccountsManager: () => setAccountsManagerOpen(false),
      updatePreferences,
      openPreferences: () => setPreferencesOpen(true),
      closePreferences: () => setPreferencesOpen(false),
    }),
    [
      sessions,
      councilSessions,
      accounts,
      activeSessionId,
      live,
      councilLive,
      ready,
      accountsManagerOpen,
      preferences,
      preferencesOpen,
      createSession,
      updateSession,
      deleteSessionById,
      sendMessage,
      createCouncilSession,
      updateCouncilSession,
      deleteCouncilSessionById,
      askCouncil,
      exportSessions,
      importSessions,
      createAccount,
      updateAccount,
      deleteAccountById,
      updatePreferences,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function mergeSessions(existing: AgentSession[], incoming: AgentSession[]): AgentSession[] {
  const byId = new Map(existing.map((session) => [session.id, session]));
  for (const session of incoming) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function mergeCouncilSessions(existing: CouncilSession[], incoming: CouncilSession[]): CouncilSession[] {
  const byId = new Map(existing.map((session) => [session.id, session]));
  for (const session of incoming) byId.set(session.id, session);
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
