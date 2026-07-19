import { useStore } from "../store";
import { ExportImportBar } from "./ExportImportBar";

export function Sidebar() {
  const { sessions, activeSessionId, setActiveSessionId, createSession, live, accounts, openAccountsManager, openPreferences } =
    useStore();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="sidebar-brand-mark" src="/logo-mark.svg" alt="" width={22} height={22} />
        <span className="sidebar-brand-name">New Vector Cowork</span>
      </div>

      <button className="sidebar-new-btn" onClick={() => createSession()}>
        <span className="sidebar-new-btn-icon">+</span> New agent
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
        {sessions.length === 0 && (
          <div className="empty-state" style={{ margin: "20px 8px", fontSize: 12 }}>
            No agents yet. Click "New agent" to create one.
          </div>
        )}
        {sessions.map((session) => {
          const isLive = Boolean(live[session.id]);
          const lastMessage = session.messages.at(-1);
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
                <div className="session-item-sub">
                  {session.providerConfig.provider} · {session.providerConfig.model}
                  {lastMessage ? ` · ${lastMessage.content.slice(0, 24)}` : ""}
                </div>
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
