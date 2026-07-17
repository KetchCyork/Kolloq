import { useState } from "react";
import { useStore } from "../store";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { ProviderConfigForm } from "./ProviderConfigForm";

export function ChatPanel() {
  const { sessions, activeSessionId, updateSession, deleteSession, sendMessage, live } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const session = sessions.find((s) => s.id === activeSessionId);

  if (!session) {
    return (
      <div className="main">
        <div className="no-session">No agent selected. Create one from the sidebar to get started.</div>
      </div>
    );
  }

  const isStreaming = Boolean(live[session.id]);

  return (
    <div className="main">
      <div className="chat-header">
        <div className="avatar" style={{ background: session.identity.color }}>
          {session.identity.emoji}
        </div>
        <div className="chat-header-meta">
          <div className="chat-header-name-row">
            <input
              className="name-input"
              value={session.identity.name}
              onChange={(e) => updateSession(session.id, { identity: { ...session.identity, name: e.target.value } })}
            />
          </div>
          <div className="chat-header-sub">
            {session.providerConfig.provider} · {session.providerConfig.model}
          </div>
        </div>
        <button className="settings-btn" onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? "Hide settings" : "Settings"}
        </button>
        <button
          className="settings-btn"
          onClick={() => {
            if (window.confirm(`Delete "${session.identity.name}"? This cannot be undone.`)) {
              deleteSession(session.id);
            }
          }}
        >
          Delete
        </button>
      </div>

      {settingsOpen && (
        <ProviderConfigForm session={session} onChange={(patch) => updateSession(session.id, patch)} />
      )}

      <MessageList session={session} live={live[session.id]} />

      <Composer disabled={isStreaming} onSend={(text) => void sendMessage(session.id, text)} />
    </div>
  );
}
