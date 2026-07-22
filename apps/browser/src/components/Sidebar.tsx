import { useStore } from "../store";
import type { AgentSession, CouncilSession } from "../types";
import { ExportImportBar } from "./ExportImportBar";

type SidebarEntry = { kind: "agent"; session: AgentSession } | { kind: "council"; session: CouncilSession };

export function Sidebar() {
  const {
    sessions,
    councilSessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    createCouncilSession,
    live,
    councilLive,
    accounts,
    openAccountsManager,
    openPreferences,
  } = useStore();

  function handleNewCouncil() {
    if (accounts.length < 2) {
      window.alert("A council needs at least 2 accounts, each on its own provider/model. Add another account first.");
      openAccountsManager();
      return;
    }
    createCouncilSession(accounts.slice(0, 2).map((account) => ({ accountId: account.id })));
  }

  const entries: SidebarEntry[] = [
    ...sessions.map((session): SidebarEntry => ({ kind: "agent", session })),
    ...councilSessions.map((session): SidebarEntry => ({ kind: "council", session })),
  ].sort((a, b) => a.session.createdAt - b.session.createdAt);

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

      <nav className="sidebar-nav">
        <button className="sidebar-nav-item" onClick={openAccountsManager}>
          <span className="sidebar-nav-icon">⚙</span> Accounts
          <span className="sidebar-nav-count">{accounts.length}</span>
        </button>
        <button className="sidebar-nav-item" onClick={openPreferences}>
          <span className="sidebar-nav-icon">⚙</span> Preferences
        </button>
      </nav>

      <div className="sidebar-section-label">Recents</div>

      <div className="session-list">
        {entries.length === 0 && (
          <div className="empty-state" style={{ margin: "20px 8px", fontSize: 12 }}>
            Nothing here yet. Click "New agent" or "New council" to create one.
          </div>
        )}
        {entries.map((entry) => {
          const session = entry.session;
          let isLive: boolean;
          let sub: string;
          if (entry.kind === "agent") {
            isLive = Boolean(live[entry.session.id]);
            const lastMessage = entry.session.messages.at(-1);
            sub = `${entry.session.providerConfig.provider} · ${entry.session.providerConfig.model}${lastMessage ? ` · ${lastMessage.content.slice(0, 24)}` : ""}`;
          } else {
            isLive = Boolean(councilLive[entry.session.id]);
            const lastTurn = entry.session.turns.at(-1);
            sub = `Council · ${entry.session.members.length} members${lastTurn ? ` · ${lastTurn.question.slice(0, 24)}` : ""}`;
          }
          return (
            <div
              key={session.id}
              className={`session-item${session.id === activeSessionId ? " active" : ""}`}
              onClick={() => setActiveSessionId(session.id)}
            >
              <div className="avatar" style={{ background: session.identity.color }}>
                {session.identity.emoji}
              </div>
              <div className="session-item-meta">
                <div className="session-item-name">{session.identity.name}</div>
                <div className="session-item-sub">{sub}</div>
              </div>
              {isLive && <div className="live-dot" title="Streaming…" />}
            </div>
          );
        })}
      </div>

      <ExportImportBar />
    </aside>
  );
}
