import type { AgentEvent, ChatAttachment, ToolCall } from "@newvector/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { runSessionTurn } from "./agentClient";
import { accountCredentialKey, deleteApiKey, isTauriRuntime, loadApiKey, saveApiKey } from "./credentials";
import {
  deleteAccount as deleteAccountRecord,
  loadAllAccounts,
  loadAllSessions,
  putAccount,
  putAllSessions,
  putSession,
  deleteSession as deleteSessionRecord,
} from "./db";
import { migrateSessionsToAccounts } from "./accountMigration";
import { applyTheme, loadPreferences, savePreferences, type Preferences } from "./preferences";
import { setTelemetryEnabled } from "./telemetry";
import type { Account, AgentSession, ProviderConfig, SessionExportFile, StoredMessage } from "./types";
import { nowMs, randomId, randomIdentity } from "./utils";

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
  const { apiKey, ...rest } = account;
  if (apiKey) {
    await saveApiKey(accountCredentialKey(account.id), apiKey);
  } else {
    await deleteApiKey(accountCredentialKey(account.id));
  }
  await putAccount(rest);
}

async function hydrateAccount(account: Account): Promise<Account> {
  if (!isTauriRuntime()) return account;
  const apiKey = await loadApiKey(accountCredentialKey(account.id));
  return apiKey ? { ...account, apiKey } : account;
}

/** Resolves a session's effective provider config, pulling credentials/baseURL from its saved account when it has one. */
function resolveProviderConfig(config: ProviderConfig, accounts: Account[]): ProviderConfig {
  if (!config.accountId) return config;
  const account = accounts.find((candidate) => candidate.id === config.accountId);
  if (!account) return config;
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
  accounts: Account[];
  activeSessionId: string | null;
  live: Record<string, LiveTurn>;
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveTurn>>({});
  const [ready, setReady] = useState(false);
  const [accountsManagerOpen, setAccountsManagerOpen] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const sessionsRef = useRef<AgentSession[]>([]);
  sessionsRef.current = sessions;
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
      const [loadedSessions, loadedAccounts] = await Promise.all([loadAllSessions(), loadAllAccounts()]);
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
      setActiveSessionId((current) => current ?? migration.sessions[0]?.id ?? null);
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

      const onEvent = (event: AgentEvent) => {
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
        const effectiveSession = {
          ...session,
          providerConfig: resolveProviderConfig(session.providerConfig, accountsRef.current),
        };
        const turn = await runSessionTurn(effectiveSession, priorMessages, text, attachments, onEvent);
        const storedTurn: StoredMessage[] = turn.map((message) => ({ ...message, id: randomId(), createdAt: nowMs() }));
        appendMessages(sessionId, storedTurn);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
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

  const exportSessions = useCallback((): SessionExportFile => {
    return {
      format: "newvector-cowork-sessions",
      version: 1,
      exportedAt: nowMs(),
      sessions: sessionsRef.current,
    };
  }, []);

  const importSessions = useCallback(async (data: SessionExportFile, mode: "merge" | "replace") => {
    if (data.format !== "newvector-cowork-sessions") {
      throw new Error("Unrecognized export file format.");
    }
    const incoming = data.sessions;
    const nextSessions = mode === "replace" ? incoming : mergeSessions(sessionsRef.current, incoming);
    setSessions(nextSessions);
    setActiveSessionId((current) => current ?? nextSessions[0]?.id ?? null);
    if (isTauriRuntime()) {
      await Promise.all(incoming.map(persistSession));
    } else {
      await putAllSessions(incoming);
    }
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
      accounts,
      activeSessionId,
      live,
      ready,
      accountsManagerOpen,
      preferences,
      preferencesOpen,
      setActiveSessionId,
      createSession,
      updateSession,
      deleteSession: deleteSessionById,
      sendMessage,
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
      accounts,
      activeSessionId,
      live,
      ready,
      accountsManagerOpen,
      preferences,
      preferencesOpen,
      createSession,
      updateSession,
      deleteSessionById,
      sendMessage,
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

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used within a StoreProvider");
  return ctx;
}
