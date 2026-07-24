import { useStore, type WorkspaceView } from "../store";
import type { AgentSession, CouncilSession, Project } from "../types";
import { councilListSubtitle, councilListTitle } from "../utils";
import { ExportImportBar } from "./ExportImportBar";

type SidebarEntry =
  | { kind: "agent"; session: AgentSession }
  | { kind: "council"; session: CouncilSession }
  | { kind: "project"; session: Project };

const NAV_ITEMS: Array<{ view: WorkspaceView; label: string; icon: JSX.Element }> = [
  {
    view: "chat",
    label: "Chat",
    icon: <path d="M21 12a8 8 0 01-8 8H5l-2 2V12a8 8 0 018-8h2a8 8 0 018 8z" />,
  },
  {
    view: "projects",
    label: "Projects",
    icon: <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />,
  },
  {
    view: "council",
    label: "Advisory Council",
    icon: (
      <>
        <circle cx="12" cy="7" r="3" />
        <circle cx="5" cy="15" r="3" />
        <circle cx="19" cy="15" r="3" />
        <path d="M12 10v3M7 13l3-3M17 13l-3-3" />
      </>
    ),
  },
  {
    view: "agents",
    label: "Agents",
    icon: (
      <>
        <rect x="4" y="8" width="16" height="12" rx="2" />
        <path d="M12 8V4M8 14h.01M16 14h.01" />
      </>
    ),
  },
  {
    view: "settings",
    label: "Settings",
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.4 2.6a7 7 0 00-2 1.2l-2.5-1-2 3.4 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.4-2.6a7 7 0 002-1.2l2.5 1 2-3.4-2-1.6c.06-.4.1-.8.1-1.2z" />
      </>
    ),
  },
];

/** Initials for the footer avatar, derived from the signed-in email (no display name in the account model yet). */
function emailInitials(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  const chars = parts.length > 1 ? [parts[0][0], parts[1][0]] : [local[0], local[1]];
  return chars.filter(Boolean).join("").toUpperCase() || "?";
}

// Falls back to a placeholder until an Open Work account/sign-in system is wired up (tracked separately).
export const PLACEHOLDER_ACCOUNT_EMAIL = "you@openwork.local";

export function Sidebar({ accountEmail = PLACEHOLDER_ACCOUNT_EMAIL }: { accountEmail?: string }) {
  const {
    sessions,
    councilSessions,
    projects,
    activeSessionId,
    setActiveSessionId,
    createSession,
    createCouncilSession,
    createProject,
    live,
    councilLive,
    projectLive,
    accounts,
    openAccountsManager,
    currentView,
    setCurrentView,
    setSettingsTab,
  } = useStore();

  function openAccountPlan() {
    setSettingsTab("account");
    setCurrentView("settings");
  }

  function handleNewCouncil() {
    if (accounts.length < 2) {
      window.alert("A council needs at least 2 accounts, each on its own provider/model. Add another account first.");
      openAccountsManager();
      return;
    }
    createCouncilSession(accounts.slice(0, 2).map((account) => ({ accountId: account.id })));
  }

  function openEntry(entry: SidebarEntry) {
    setActiveSessionId(entry.session.id);
    setCurrentView(entry.kind === "council" ? "council" : entry.kind === "project" ? "projects" : "chat");
  }

  const entries: SidebarEntry[] = [
    ...sessions.map((session): SidebarEntry => ({ kind: "agent", session })),
    ...councilSessions.map((session): SidebarEntry => ({ kind: "council", session })),
    ...projects.map((session): SidebarEntry => ({ kind: "project", session })),
  ].sort((a, b) => b.session.createdAt - a.session.createdAt);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="sidebar-brand-mark" src="/logo-mark.svg" alt="" width={22} height={22} />
        <span className="sidebar-brand-name">Open Work</span>
      </div>

      <button className="sidebar-new-btn" onClick={() => createSession()}>
        <span className="sidebar-new-btn-icon">+</span> New agent
      </button>
      <button className="sidebar-new-btn sidebar-new-council-btn" onClick={handleNewCouncil}>
        <span className="sidebar-new-btn-icon">+</span> New council
      </button>
      <button className="sidebar-new-btn sidebar-new-council-btn" onClick={() => createProject()}>
        <span className="sidebar-new-btn-icon">+</span> New project
      </button>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            className={`nav-item${currentView === item.view ? " active" : ""}`}
            onClick={() => setCurrentView(item.view)}
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2}>
              {item.icon}
            </svg>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-section-label">Recents</div>

      <div className="session-list">
        {entries.length === 0 && (
          <div className="empty-state" style={{ margin: "20px 8px", fontSize: 12 }}>
            Nothing here yet. Click "New agent", "New council", or "New project" to create one.
          </div>
        )}
        {entries.map((entry) => {
          const session = entry.session;
          let isLive: boolean;
          let title: string;
          let sub: string;
          if (entry.kind === "agent") {
            isLive = Boolean(live[entry.session.id]);
            const lastMessage = entry.session.messages.at(-1);
            title = entry.session.identity.name;
            sub = `${entry.session.providerConfig.provider} · ${entry.session.providerConfig.model}${lastMessage ? ` · ${lastMessage.content.slice(0, 24)}` : ""}`;
          } else if (entry.kind === "council") {
            isLive = Boolean(councilLive[entry.session.id]);
            title = councilListTitle(entry.session);
            sub = councilListSubtitle(entry.session, isLive);
          } else {
            isLive = Boolean(projectLive[entry.session.id]);
            title = entry.session.identity.name;
            sub = `${entry.session.roster.length} agent${entry.session.roster.length === 1 ? "" : "s"} · Project`;
          }
          return (
            <div
              key={session.id}
              className={`session-item${session.id === activeSessionId ? " active" : ""}`}
              onClick={() => openEntry(entry)}
            >
              <div className="avatar" style={{ background: session.identity.color }}>
                {session.identity.emoji}
              </div>
              <div className="session-item-meta">
                <div className="session-item-name" title={title}>
                  {title}
                </div>
                <div className="session-item-sub">{sub}</div>
              </div>
              {isLive && <div className="live-dot" title="Streaming…" />}
            </div>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <div className="avatar">{emailInitials(accountEmail)}</div>
        <div className="sidebar-footer-identity">{accountEmail}</div>
        <span
          className="plan-pill"
          onClick={openAccountPlan}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") openAccountPlan();
          }}
        >
          FREE
        </span>
      </div>

      <ExportImportBar />
    </aside>
  );
}
