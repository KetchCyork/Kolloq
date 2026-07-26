import { CouncilController } from "@newvector/core";
import type { AgentEvent, ChatAttachment, ChatMessage, CouncilEvent, ToolCall } from "@newvector/core";
import { classifyProviderError } from "@newvector/core";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getToolCount, runProjectTurn, runSessionTurn } from "./agentClient";
import { filesToAttachments } from "./attachments";
import { runCouncilTurn } from "./councilClient";
import {
  applyCouncilEvent,
  computeTotalCostNote,
  DEFAULT_COUNCIL_MAX_ROUNDS,
  initialLiveCouncilTurn,
  validateCouncilMembers,
} from "./councilReducer";
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
  deleteProject as deleteProjectRecord,
  deleteProjectFolderHandle,
  loadAllAccounts,
  loadAllCouncilSessions,
  loadAllProjects,
  loadAllSessions,
  loadAllSkills,
  putAccount,
  putAllCouncilSessions,
  putAllSessions,
  putCouncilSession,
  putProject,
  putProjectFolderHandle,
  putSession,
  putSkill,
  deleteSession as deleteSessionRecord,
  deleteSkill as deleteSkillRecord,
} from "./db";
import { migrateSessionsToAccounts } from "./accountMigration";
import { applyTheme, loadPreferences, savePreferences, type Preferences } from "./preferences";
import { pickWorkingFolder, workingFolderName, type WorkingFolderHandle } from "./projectFolder";
import { resolveRoutedMember } from "./projectRouting";
import { composeAgentSystemPrompt, skillsForAgent } from "./skills";
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
  Project,
  ProjectChatMessage,
  ProjectKnowledgeFile,
  ProjectMemberConfig,
  ProjectTask,
  ProjectTaskStatus,
  ProviderConfig,
  SessionExportFile,
  Skill,
  StoredMessage,
} from "./types";
import {
  councilIdentity,
  isAutoCouncilName,
  nowMs,
  randomId,
  randomIdentity,
  renameLegacyCouncilIdentities,
  shortCouncilTitle,
  titleUntitledCouncils,
} from "./utils";

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

/** Top-level sidebar nav areas from the Open Work mockup/spec (§3.2). */
export type WorkspaceView = "chat" | "projects" | "council" | "agents" | "settings";

/** Left-nav tabs inside the Settings view (spec §7). */
export type SettingsTabId = "account" | "connections" | "skills" | "plugins" | "integrations" | "usage" | "general";

interface StoreState {
  sessions: AgentSession[];
  councilSessions: CouncilSession[];
  projects: Project[];
  accounts: Account[];
  skills: Skill[];
  activeSessionId: string | null;
  live: Record<string, LiveTurn>;
  councilLive: Record<string, LiveCouncilTurn>;
  projectLive: Record<string, LiveTurn>;
  ready: boolean;
  preferences: Preferences;
  currentView: WorkspaceView;
  settingsTab: SettingsTabId;
}

interface StoreApi extends StoreState {
  setActiveSessionId: (id: string) => void;
  setCurrentView: (view: WorkspaceView) => void;
  setSettingsTab: (tab: SettingsTabId) => void;
  createSession: () => AgentSession;
  updateSession: (id: string, patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => void;
  deleteSession: (id: string) => void;
  sendMessage: (sessionId: string, text: string, attachments?: ChatAttachment[]) => Promise<void>;
  createCouncilSession: (members: Array<Omit<CouncilMemberConfig, "id">>) => CouncilSession;
  updateCouncilSession: (
    id: string,
    patch: Partial<Pick<CouncilSession, "identity" | "members" | "maxRounds" | "moderatorAccountId" | "budgetCap">>,
  ) => void;
  deleteCouncilSession: (id: string) => void;
  askCouncil: (sessionId: string, question: string) => Promise<void>;
  /** Mid-debate controls for a council turn currently in `councilLive` — no-ops once it's finished. */
  pauseCouncilTurn: (sessionId: string) => void;
  resumeCouncilTurn: (sessionId: string) => void;
  injectCouncilMessage: (sessionId: string, message: string) => void;
  forceCouncilVote: (sessionId: string) => void;
  exportSessions: () => SessionExportFile;
  importSessions: (data: SessionExportFile, mode: "merge" | "replace") => Promise<void>;
  createAccount: (input: Omit<Account, "id" | "createdAt">) => Account;
  updateAccount: (id: string, patch: Partial<Omit<Account, "id" | "createdAt">>) => void;
  deleteAccount: (id: string) => void;
  /** Jumps straight to the Connections tab of Settings — used where an unrelated flow (Council setup, the
   * model picker) needs the user to add a provider account before it can continue. */
  openAccountsManager: () => void;
  updatePreferences: (patch: Partial<Preferences>) => void;
  /** Jumps straight to the General tab of Settings. */
  openPreferences: () => void;
  createSkill: (input: Omit<Skill, "id" | "createdAt" | "updatedAt">) => Skill;
  updateSkill: (id: string, patch: Partial<Omit<Skill, "id" | "createdAt">>) => void;
  deleteSkill: (id: string) => void;
  /** Attaches/detaches one skill to one agent — the write both the Skills pane's agent picker and the
   * agent drawer's skill list make, so neither has to rebuild `attachedAgentIds` itself. */
  setSkillAttached: (skillId: string, agentId: string, attached: boolean) => void;
  /** Jumps straight to the Skills tab of Settings. */
  openSkillsManager: () => void;
  createProject: () => Project;
  updateProject: (id: string, patch: Partial<Pick<Project, "identity" | "instructions">>) => void;
  deleteProject: (id: string) => void;
  connectProjectFolder: (id: string) => Promise<void>;
  disconnectProjectFolder: (id: string) => void;
  addProjectMember: (projectId: string, input: Omit<ProjectMemberConfig, "id">) => void;
  updateProjectMember: (projectId: string, memberId: string, patch: Partial<Omit<ProjectMemberConfig, "id">>) => void;
  removeProjectMember: (projectId: string, memberId: string) => void;
  addProjectTask: (projectId: string, title: string, assigneeId?: string) => void;
  updateProjectTaskStatus: (projectId: string, taskId: string, status: ProjectTaskStatus) => void;
  deleteProjectTask: (projectId: string, taskId: string) => void;
  addProjectKnowledgeFiles: (projectId: string, files: File[]) => Promise<void>;
  removeProjectKnowledgeFile: (projectId: string, fileId: string) => void;
  sendProjectMessage: (
    projectId: string,
    text: string,
    pickedMemberId: string,
    attachments?: ChatAttachment[],
  ) => Promise<void>;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [councilSessions, setCouncilSessions] = useState<CouncilSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, LiveTurn>>({});
  const [councilLive, setCouncilLive] = useState<Record<string, LiveCouncilTurn>>({});
  const [projectLive, setProjectLive] = useState<Record<string, LiveTurn>>({});
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() => loadPreferences());
  const [currentView, setCurrentView] = useState<WorkspaceView>("chat");
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>("account");
  const sessionsRef = useRef<AgentSession[]>([]);
  sessionsRef.current = sessions;
  const councilSessionsRef = useRef<CouncilSession[]>([]);
  councilSessionsRef.current = councilSessions;
  const projectsRef = useRef<Project[]>([]);
  projectsRef.current = projects;
  const accountsRef = useRef<Account[]>([]);
  accountsRef.current = accounts;
  const skillsRef = useRef<Skill[]>([]);
  skillsRef.current = skills;
  const preferencesRef = useRef<Preferences>(preferences);
  preferencesRef.current = preferences;
  const initStarted = useRef(false);
  /** One live `CouncilController` per in-progress council turn, keyed by session id — not React
   * state, since pause/resume/inject/force-vote take effect through the engine's event stream
   * (which already drives `councilLive`), not by re-rendering off the controller itself. */
  const councilControllersRef = useRef<Record<string, CouncilController>>({});

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
      const [loadedSessions, loadedAccounts, loadedCouncilSessions, loadedProjects, loadedSkills] = await Promise.all([
        loadAllSessions(),
        loadAllAccounts(),
        loadAllCouncilSessions(),
        loadAllProjects(),
        loadAllSkills(),
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
      // Councils created before they had their own naming were stored as "Agent N"; rename them,
      // then title the ones that already have a question to answer for (see titleUntitledCouncils).
      const renamed = renameLegacyCouncilIdentities(loadedCouncilSessions);
      const titled = titleUntitledCouncils(renamed.sessions);
      const changedCouncilIds = new Set([...renamed.changedIds, ...titled.changedIds]);
      await Promise.all(
        titled.sessions.filter((session) => changedCouncilIds.has(session.id)).map(putCouncilSession),
      );
      setCouncilSessions(titled.sessions);
      setProjects(loadedProjects);
      setSkills(loadedSkills);
      setActiveSessionId((current) => current ?? migration.sessions[0]?.id ?? titled.sessions[0]?.id ?? null);
      // No agent sessions to land on but a council exists — open straight to the Advisory Council view instead of an empty Chat.
      if (migration.sessions.length === 0 && titled.sessions.length > 0) {
        setCurrentView("council");
      }
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
    setCurrentView("chat");
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

  const createSkill = useCallback((input: Omit<Skill, "id" | "createdAt" | "updatedAt">): Skill => {
    const skill: Skill = { ...input, id: randomId(), createdAt: nowMs(), updatedAt: nowMs() };
    setSkills((prev) => [...prev, skill]);
    void putSkill(skill);
    return skill;
  }, []);

  const updateSkill = useCallback((id: string, patch: Partial<Omit<Skill, "id" | "createdAt">>) => {
    setSkills((prev) =>
      prev.map((skill) => {
        if (skill.id !== id) return skill;
        const updated = { ...skill, ...patch, updatedAt: nowMs() };
        void putSkill(updated);
        return updated;
      }),
    );
  }, []);

  const deleteSkillById = useCallback((id: string) => {
    setSkills((prev) => prev.filter((skill) => skill.id !== id));
    void deleteSkillRecord(id);
  }, []);

  const setSkillAttached = useCallback((skillId: string, agentId: string, attached: boolean) => {
    setSkills((prev) =>
      prev.map((skill) => {
        if (skill.id !== skillId) return skill;
        const already = skill.attachedAgentIds.includes(agentId);
        if (already === attached) return skill;
        const attachedAgentIds = attached
          ? [...skill.attachedAgentIds, agentId]
          : skill.attachedAgentIds.filter((candidate) => candidate !== agentId);
        const updated = { ...skill, attachedAgentIds, updatedAt: nowMs() };
        void putSkill(updated);
        return updated;
      }),
    );
  }, []);

  /** Drops a deleted agent from every skill's attachment list, so the Skills pane never shows a
   * count that includes agents that no longer exist. */
  const detachAgentFromSkills = useCallback((agentId: string) => {
    setSkills((prev) =>
      prev.map((skill) => {
        if (!skill.attachedAgentIds.includes(agentId)) return skill;
        const updated = {
          ...skill,
          attachedAgentIds: skill.attachedAgentIds.filter((candidate) => candidate !== agentId),
          updatedAt: nowMs(),
        };
        void putSkill(updated);
        return updated;
      }),
    );
  }, []);

  const deleteSessionById = useCallback(
    (id: string) => {
      setSessions((prev) => prev.filter((session) => session.id !== id));
      void deleteSessionRecord(id);
      detachAgentFromSkills(id);
      if (isTauriRuntime()) void deleteApiKey(id);
      setActiveSessionId((current) => {
        if (current !== id) return current;
        const remaining = sessionsRef.current.filter((session) => session.id !== id);
        return remaining[0]?.id ?? null;
      });
    },
    [detachAgentFromSkills],
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
      capture({ type: "message_sent", provider: session.providerConfig.provider, toolCount: getToolCount(sessionId) });

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
          // Attached, enabled skills are folded in per turn rather than baked into `systemPrompt`, so
          // editing or toggling a skill in Settings takes effect on the next message.
          systemPrompt: composeAgentSystemPrompt(session.systemPrompt, skillsForAgent(skillsRef.current, session.id)),
          providerConfig: resolveProviderConfig(session.providerConfig, accountsForTurn),
        };
        const turn = await runSessionTurn(effectiveSession, priorMessages, text, attachments, onEvent);
        const storedTurn: StoredMessage[] = turn.map((message) => ({ ...message, id: randomId(), createdAt: nowMs() }));
        appendMessages(sessionId, storedTurn);
      } catch (error) {
        capture({ type: "provider_error", provider: session.providerConfig.provider });
        const { reason, isConfigIssue } = classifyProviderError(error);
        appendMessages(sessionId, [
          { id: randomId(), createdAt: nowMs(), role: "assistant", content: "", error: { reason, isConfigIssue } },
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
    setCurrentView("council");
    void putCouncilSession(session);
    return session;
  }, []);

  const updateCouncilSession = useCallback(
    (
      id: string,
      patch: Partial<Pick<CouncilSession, "identity" | "members" | "maxRounds" | "moderatorAccountId" | "budgetCap">>,
    ) => {
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

    const maxRounds = session.maxRounds ?? DEFAULT_COUNCIL_MAX_ROUNDS;
    let liveTurn: LiveCouncilTurn = initialLiveCouncilTurn(question, maxRounds);
    setCouncilLive((prev) => ({ ...prev, [sessionId]: liveTurn }));

    const controller = new CouncilController();
    councilControllersRef.current[sessionId] = controller;

    const onEvent = (event: CouncilEvent) => {
      liveTurn = applyCouncilEvent(liveTurn, event, session.members, accountsRef.current);
      setCouncilLive((prev) => ({ ...prev, [sessionId]: liveTurn }));
    };

    try {
      const result = await runCouncilTurn(
        session.members,
        accountsForTurn,
        maxRounds,
        session.moderatorAccountId,
        question,
        onEvent,
        controller,
        session.budgetCap,
      );
      // On a moderator error, the "moderator-error" event only carries the error message — the
      // engine's deterministic fallback synthesis (see Council.fallbackSynthesis) lives on the
      // resolved result instead, so surface it here rather than leaving the turn's answer empty.
      if (!liveTurn.answer && result.answer) {
        liveTurn = { ...liveTurn, answer: result.answer };
      }
    } catch (error) {
      // Council.run() itself never rejects (member/moderator errors surface as events); this only
      // fires for setup failures, e.g. a member's account was removed after validation passed.
      const message = error instanceof Error ? error.message : String(error);
      liveTurn = { ...liveTurn, moderatorError: liveTurn.moderatorError ?? message, finished: true };
    } finally {
      delete councilControllersRef.current[sessionId];
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
          budgetExceeded: liveTurn.budgetExceeded,
          finalRound: Math.max(0, liveTurn.rounds.length - 1),
          maxRounds,
          dropped: liveTurn.dropped,
          answer: liveTurn.answer ?? "",
          moderatorError: liveTurn.moderatorError,
          alignmentScores: liveTurn.alignmentScores,
          forcedVote: liveTurn.forcedVote,
          totalCostNote: computeTotalCostNote(
            liveTurn.rounds,
            liveTurn.answer,
            session.members,
            accountsRef.current,
            session.moderatorAccountId,
          ),
        };
        setCouncilSessions((prev) =>
          prev.map((candidate) => {
            if (candidate.id !== sessionId) return candidate;
            // The first question a council is asked becomes its title, so the sidebar says what the
            // council is about instead of "Council 3". Renamed councils keep the name they were given.
            const shouldTitle = candidate.turns.length === 0 && isAutoCouncilName(candidate.identity.name);
            const title = shouldTitle ? shortCouncilTitle(turnRecord.question) : "";
            const updated = {
              ...candidate,
              identity: title ? { ...candidate.identity, name: title } : candidate.identity,
              turns: [...candidate.turns, turnRecord],
              updatedAt: nowMs(),
            };
            void putCouncilSession(updated);
            return updated;
          }),
        );
      }
    }
  }, []);

  /** No-ops once the turn has finished (its controller was already removed in `askCouncil`'s
   * `finally`) — the buttons that call these are themselves disabled once `live.finished`, but a
   * stray late click shouldn't throw. */
  const pauseCouncilTurn = useCallback((sessionId: string) => {
    councilControllersRef.current[sessionId]?.pause();
  }, []);

  const resumeCouncilTurn = useCallback((sessionId: string) => {
    councilControllersRef.current[sessionId]?.resume();
  }, []);

  const injectCouncilMessage = useCallback((sessionId: string, message: string) => {
    councilControllersRef.current[sessionId]?.inject(message);
  }, []);

  const forceCouncilVote = useCallback((sessionId: string) => {
    councilControllersRef.current[sessionId]?.forceVote();
  }, []);

  const createProject = useCallback((): Project => {
    const identity = randomIdentity(
      sessionsRef.current.length + councilSessionsRef.current.length + projectsRef.current.length,
    );
    const project: Project = {
      id: randomId(),
      identity,
      roster: [],
      tasks: [],
      knowledgeFiles: [],
      instructions: "",
      messages: [],
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };
    setProjects((prev) => [...prev, project]);
    setActiveSessionId(project.id);
    setCurrentView("projects");
    void putProject(project);
    return project;
  }, []);

  const updateProjectById = useCallback(
    (id: string, patch: Partial<Pick<Project, "identity" | "instructions">>) => {
      setProjects((prev) =>
        prev.map((project) => {
          if (project.id !== id) return project;
          const updated = { ...project, ...patch, updatedAt: nowMs() };
          void putProject(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const deleteProjectById = useCallback((id: string) => {
    setProjects((prev) => prev.filter((project) => project.id !== id));
    void deleteProjectRecord(id);
    void deleteProjectFolderHandle(id);
    setActiveSessionId((current) => {
      if (current !== id) return current;
      const remainingProjects = projectsRef.current.filter((project) => project.id !== id);
      return sessionsRef.current[0]?.id ?? councilSessionsRef.current[0]?.id ?? remainingProjects[0]?.id ?? null;
    });
  }, []);

  /** Opens the native folder picker and connects the chosen folder. No-ops (no thrown error
   * surfaced) if the user cancels the dialog or the browser doesn't support the File System
   * Access API — the folder bar just stays in its current/disconnected state either way. */
  const connectProjectFolder = useCallback(async (id: string) => {
    let handle: WorkingFolderHandle;
    try {
      handle = await pickWorkingFolder();
    } catch {
      return;
    }
    await putProjectFolderHandle(id, handle);
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== id) return project;
        const updated: Project = {
          ...project,
          workingFolder: { name: workingFolderName(handle), connectedAt: nowMs() },
          updatedAt: nowMs(),
        };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const disconnectProjectFolder = useCallback((id: string) => {
    void deleteProjectFolderHandle(id);
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== id) return project;
        const { workingFolder: _folder, ...rest } = project;
        const updated: Project = { ...rest, updatedAt: nowMs() };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const addProjectMember = useCallback((projectId: string, input: Omit<ProjectMemberConfig, "id">) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = { ...project, roster: [...project.roster, { ...input, id: randomId() }], updatedAt: nowMs() };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const updateProjectMember = useCallback(
    (projectId: string, memberId: string, patch: Partial<Omit<ProjectMemberConfig, "id">>) => {
      setProjects((prev) =>
        prev.map((project) => {
          if (project.id !== projectId) return project;
          const updated = {
            ...project,
            roster: project.roster.map((member) => (member.id === memberId ? { ...member, ...patch } : member)),
            updatedAt: nowMs(),
          };
          void putProject(updated);
          return updated;
        }),
      );
    },
    [],
  );

  const removeProjectMember = useCallback((projectId: string, memberId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = {
          ...project,
          roster: project.roster.filter((member) => member.id !== memberId),
          updatedAt: nowMs(),
        };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const addProjectTask = useCallback((projectId: string, title: string, assigneeId?: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const task: ProjectTask = {
          id: randomId(),
          title,
          status: "todo",
          assigneeId,
          createdAt: nowMs(),
          updatedAt: nowMs(),
        };
        const updated = { ...project, tasks: [...project.tasks, task], updatedAt: nowMs() };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const updateProjectTaskStatus = useCallback((projectId: string, taskId: string, status: ProjectTaskStatus) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = {
          ...project,
          tasks: project.tasks.map((task) => (task.id === taskId ? { ...task, status, updatedAt: nowMs() } : task)),
          updatedAt: nowMs(),
        };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const deleteProjectTask = useCallback((projectId: string, taskId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = { ...project, tasks: project.tasks.filter((task) => task.id !== taskId), updatedAt: nowMs() };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const addProjectKnowledgeFiles = useCallback(async (projectId: string, files: File[]) => {
    const { attachments } = await filesToAttachments(files);
    if (attachments.length === 0) return;
    const knowledgeFiles: ProjectKnowledgeFile[] = attachments.map((attachment) => ({ ...attachment, addedAt: nowMs() }));
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = {
          ...project,
          knowledgeFiles: [...project.knowledgeFiles, ...knowledgeFiles],
          updatedAt: nowMs(),
        };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const removeProjectKnowledgeFile = useCallback((projectId: string, fileId: string) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = {
          ...project,
          knowledgeFiles: project.knowledgeFiles.filter((file) => file.id !== fileId),
          updatedAt: nowMs(),
        };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const appendProjectMessages = useCallback((projectId: string, messages: ProjectChatMessage[]) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const updated = { ...project, messages: [...project.messages, ...messages], updatedAt: nowMs() };
        void putProject(updated);
        return updated;
      }),
    );
  }, []);

  const sendProjectMessage = useCallback(
    async (projectId: string, text: string, pickedMemberId: string, attachments?: ChatAttachment[]) => {
      const project = projectsRef.current.find((candidate) => candidate.id === projectId);
      if (!project) return;

      const userMessage: ProjectChatMessage = {
        id: randomId(),
        createdAt: nowMs(),
        role: "user",
        content: text,
        ...(attachments?.length ? { attachments } : {}),
      };
      appendProjectMessages(projectId, [userMessage]);

      const member = resolveRoutedMember(text, project.roster, pickedMemberId);
      if (!member) {
        appendProjectMessages(projectId, [
          {
            id: randomId(),
            createdAt: nowMs(),
            role: "assistant",
            content: "⚠️ Add an agent to the roster before starting a project chat.",
          },
        ]);
        return;
      }

      let accountsForTurn = accountsRef.current;
      const account = accountsForTurn.find((candidate) => candidate.id === member.accountId);
      if (!account) {
        appendProjectMessages(projectId, [
          {
            id: randomId(),
            createdAt: nowMs(),
            role: "assistant",
            memberId: member.id,
            content: `⚠️ ${member.identity.name}'s connection was removed. Reconnect it in Accounts.`,
          },
        ]);
        return;
      }

      setProjectLive((prev) => ({ ...prev, [projectId]: { text: "", toolCalls: [] } }));

      let turnError: Error | undefined;
      const onEvent = (event: AgentEvent) => {
        if (event.type === "error") turnError = event.error;
        setProjectLive((prev) => {
          const turn = prev[projectId] ?? { text: "", toolCalls: [] };
          if (event.type === "text-delta") {
            return { ...prev, [projectId]: { ...turn, text: turn.text + event.delta } };
          }
          if (event.type === "error") {
            return { ...prev, [projectId]: { ...turn, error: event.error.message } };
          }
          return prev;
        });
      };

      try {
        const fresh = await refreshAccountIfNeeded(account);
        if (fresh !== account) {
          accountsForTurn = accountsForTurn.map((candidate) => (candidate.id === account.id ? fresh : candidate));
        }
        const providerConfig = resolveProviderConfig(
          { provider: account.provider, model: account.model, accountId: account.id },
          accountsForTurn,
        );
        const systemPrompt = [project.instructions, member.role ? `Your role on this project: ${member.role}.` : ""]
          .filter(Boolean)
          .join("\n\n");
        const priorMessages: ChatMessage[] = project.messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        }));
        const turn = await runProjectTurn(providerConfig, systemPrompt, priorMessages, text, attachments, onEvent);
        const meaningful = turn.filter((message) => message.content && message.content.trim().length > 0);
        if (meaningful.length > 0) {
          const storedTurn: ProjectChatMessage[] = meaningful.map((message) => ({
            id: randomId(),
            createdAt: nowMs(),
            role: "assistant",
            memberId: member.id,
            content: message.content,
          }));
          appendProjectMessages(projectId, storedTurn);
        } else if (turnError) {
          const { reason, isConfigIssue } = classifyProviderError(turnError);
          appendProjectMessages(projectId, [
            {
              id: randomId(),
              createdAt: nowMs(),
              role: "assistant",
              memberId: member.id,
              content: "",
              error: { reason, isConfigIssue },
            },
          ]);
        }
      } catch (error) {
        const { reason, isConfigIssue } = classifyProviderError(error);
        appendProjectMessages(projectId, [
          {
            id: randomId(),
            createdAt: nowMs(),
            role: "assistant",
            memberId: member.id,
            content: "",
            error: { reason, isConfigIssue },
          },
        ]);
      } finally {
        setProjectLive((prev) => {
          const next = { ...prev };
          delete next[projectId];
          return next;
        });
      }
    },
    [appendProjectMessages, refreshAccountIfNeeded],
  );

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
      projects,
      accounts,
      skills,
      activeSessionId,
      live,
      councilLive,
      projectLive,
      ready,
      preferences,
      currentView,
      settingsTab,
      setActiveSessionId,
      setCurrentView,
      setSettingsTab,
      createSession,
      updateSession,
      deleteSession: deleteSessionById,
      sendMessage,
      createCouncilSession,
      updateCouncilSession,
      deleteCouncilSession: deleteCouncilSessionById,
      askCouncil,
      pauseCouncilTurn,
      resumeCouncilTurn,
      injectCouncilMessage,
      forceCouncilVote,
      exportSessions,
      importSessions,
      createAccount,
      updateAccount,
      deleteAccount: deleteAccountById,
      openAccountsManager: () => {
        setSettingsTab("connections");
        setCurrentView("settings");
      },
      updatePreferences,
      openPreferences: () => {
        setSettingsTab("general");
        setCurrentView("settings");
      },
      createSkill,
      updateSkill,
      deleteSkill: deleteSkillById,
      setSkillAttached,
      openSkillsManager: () => {
        setSettingsTab("skills");
        setCurrentView("settings");
      },
      createProject,
      updateProject: updateProjectById,
      deleteProject: deleteProjectById,
      connectProjectFolder,
      disconnectProjectFolder,
      addProjectMember,
      updateProjectMember,
      removeProjectMember,
      addProjectTask,
      updateProjectTaskStatus,
      deleteProjectTask,
      addProjectKnowledgeFiles,
      removeProjectKnowledgeFile,
      sendProjectMessage,
    }),
    [
      sessions,
      councilSessions,
      projects,
      accounts,
      skills,
      activeSessionId,
      live,
      councilLive,
      projectLive,
      ready,
      preferences,
      currentView,
      settingsTab,
      createSession,
      updateSession,
      deleteSessionById,
      sendMessage,
      createCouncilSession,
      updateCouncilSession,
      deleteCouncilSessionById,
      askCouncil,
      pauseCouncilTurn,
      resumeCouncilTurn,
      injectCouncilMessage,
      forceCouncilVote,
      exportSessions,
      importSessions,
      createAccount,
      updateAccount,
      deleteAccountById,
      updatePreferences,
      createSkill,
      updateSkill,
      deleteSkillById,
      setSkillAttached,
      createProject,
      updateProjectById,
      deleteProjectById,
      connectProjectFolder,
      disconnectProjectFolder,
      addProjectMember,
      updateProjectMember,
      removeProjectMember,
      addProjectTask,
      updateProjectTaskStatus,
      deleteProjectTask,
      addProjectKnowledgeFiles,
      removeProjectKnowledgeFile,
      sendProjectMessage,
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
