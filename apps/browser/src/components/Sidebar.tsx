import { useStore } from "../store";
import { ExportImportBar } from "./ExportImportBar";

export function Sidebar() {
  const { sessions, activeSessionId, setActiveSessionId, createSession, live } = useStore();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Agent Sessions</h1>
        <button className="icon-btn" title="New agent session" onClick={() => createSession()}>
          +
        </button>
      </div>

      <div className="session-list">
        {sessions.length === 0 && (
          <div className="empty-state" style={{ margin: "20px 8px", fontSize: 12 }}>
            No agents yet. Click + to create one.
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
