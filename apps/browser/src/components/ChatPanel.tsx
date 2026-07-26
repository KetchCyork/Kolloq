import { useState } from "react";
import { confirmDialog } from "../dialogs";
import { useStore } from "../store";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { SessionSettingsForm } from "./SessionSettingsForm";

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
  const isEmpty = session.messages.length === 0 && !live[session.id];

  const composer = (
    <Composer
      disabled={isStreaming}
      providerConfig={session.providerConfig}
      onProviderConfigChange={(patch) => updateSession(session.id, { providerConfig: { ...session.providerConfig, ...patch } })}
      onSend={(text, attachments) => void sendMessage(session.id, text, attachments)}
    />
  );

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
        </div>
        <button className="settings-btn" onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? "Hide settings" : "Settings"}
        </button>
        <button
          className="settings-btn"
          onClick={async () => {
            if (await confirmDialog({ message: `Delete "${session.identity.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true })) {
              deleteSession(session.id);
            }
          }}
        >
          Delete
        </button>
      </div>

      {settingsOpen && <SessionSettingsForm session={session} onChange={(patch) => updateSession(session.id, patch)} />}

      {isEmpty ? (
        <div className="empty-hero">
          <h1>{session.identity.name}</h1>
          <p>Start a conversation — messages stream live and tool calls show inline.</p>
          <div className="empty-hero-composer">{composer}</div>
        </div>
      ) : (
        <>
          <MessageList session={session} live={live[session.id]} />
          {composer}
        </>
      )}
    </div>
  );
}
