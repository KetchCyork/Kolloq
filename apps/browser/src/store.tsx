import type { AgentEvent, ToolCall } from "@newvector/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { runSessionTurn } from "./agentClient";
import { deleteApiKey, isTauriRuntime, loadApiKey, saveApiKey } from "./credentials";
import { loadAllSessions, putAllSessions, putSession, deleteSession as deleteSessionRecord } from "./db";
import type { AgentSession, SessionExportFile, StoredMessage } from "./types";
import { defaultProviderConfig, nowMs, randomId, randomIdentity } from "./utils";

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

export interface LiveToolCall {
  call: ToolCall;
  status: "running" | "done" | "error";
  result?: unknown;
}

export interface LiveTurn {
  text: string;
  toolCalls: LiveToolCall[];
  error?: string;
}

interface StoreState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  live: Record<string, LiveTurn>;
  ready: boolean;
}

interface StoreApi extends StoreState {
  setActiveSessionId: (id: string) => void;
  createSession: () => AgentSession;
  updateSession: (id: string, patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => void;
  deleteSession: (id: string) => void;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  exportSessions: () => SessionExportFile;
  importSessions: (data: SessionExportFile, mode: "merge" | "replace") => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveTurn>>({});
  const [ready, setReady] = useState(false);
  const sessionsRef = useRef<AgentSession[]>([]);
  sessionsRef.current = sessions;

  useEffect(() => {
    loadAllSessions()
      .then((loaded) => Promise.all(loaded.map(hydrateSession)))
      .then((loaded) => {
        setSessions(loaded);
        setActiveSessionId((current) => current ?? loaded[0]?.id ?? null);
        setReady(true);
      });
  }, []);

  const createSession = useCallback((): AgentSession => {
    const session: AgentSession = {
      id: randomId(),
      identity: randomIdentity(sessionsRef.current.length),
      providerConfig: defaultProviderConfig(),
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
    async (sessionId: string, text: string) => {
      const session = sessionsRef.current.find((candidate) => candidate.id === sessionId);
      if (!session) return;

      const priorMessages = session.messages;
      const userMessage: StoredMessage = { id: randomId(), createdAt: nowMs(), role: "user", content: text };
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
        const turn = await runSessionTurn(session, priorMessages, text, onEvent);
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

  const value = useMemo<StoreApi>(
    () => ({
      sessions,
      activeSessionId,
      live,
      ready,
      setActiveSessionId,
      createSession,
      updateSession,
      deleteSession: deleteSessionById,
      sendMessage,
      exportSessions,
      importSessions,
    }),
    [sessions, activeSessionId, live, ready, createSession, updateSession, deleteSessionById, sendMessage, exportSessions, importSessions],
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
