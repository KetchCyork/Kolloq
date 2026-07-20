import { useState } from "react";
import { validateCouncilMembers } from "../councilReducer";
import { useStore } from "../store";
import type { CouncilSession } from "../types";
import { CouncilSetupForm } from "./CouncilSetupForm";
import { CouncilLiveView } from "./CouncilLiveView";
import { CouncilTranscript } from "./CouncilTranscript";

export function CouncilPanel({ session }: { session: CouncilSession }) {
  const { accounts, updateCouncilSession, deleteCouncilSession, askCouncil, councilLive } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [askError, setAskError] = useState<string | null>(null);

  const live = councilLive[session.id];
  const isRunning = Boolean(live);
  const validationError = validateCouncilMembers(session.members, accounts);
  const isEmpty = session.turns.length === 0 && !live;

  async function handleAsk() {
    const text = question.trim();
    if (!text || isRunning || validationError) return;
    setAskError(null);
    setQuestion("");
    try {
      await askCouncil(session.id, text);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : String(error));
    }
  }

  const composer = (
    <div className="composer council-composer">
      {validationError && (
        <div className="council-setup-error">{validationError} Open "Council setup" to fix it.</div>
      )}
      {askError && <div className="council-setup-error">{askError}</div>}
      <textarea
        placeholder="Ask the council a question…"
        value={question}
        disabled={isRunning || Boolean(validationError)}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleAsk();
          }
        }}
      />
      <div className="composer-actions">
        <button
          type="button"
          disabled={isRunning || !question.trim() || Boolean(validationError)}
          onClick={() => void handleAsk()}
        >
          {isRunning ? "Debating…" : "Ask the council"}
        </button>
      </div>
    </div>
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
              onChange={(event) =>
                updateCouncilSession(session.id, { identity: { ...session.identity, name: event.target.value } })
              }
            />
          </div>
          <div className="chat-header-sub">
            Advisory Council · {session.members.length} member{session.members.length === 1 ? "" : "s"}
          </div>
        </div>
        <button className="settings-btn" onClick={() => setSettingsOpen((open) => !open)}>
          {settingsOpen ? "Hide setup" : "Council setup"}
        </button>
        <button
          className="settings-btn"
          onClick={() => {
            if (window.confirm(`Delete "${session.identity.name}"? This cannot be undone.`)) {
              deleteCouncilSession(session.id);
            }
          }}
        >
          Delete
        </button>
      </div>

      {settingsOpen && (
        <div className="settings-panel">
          <CouncilSetupForm
            session={session}
            onChange={(patch) => updateCouncilSession(session.id, patch)}
          />
        </div>
      )}

      {isEmpty ? (
        <div className="empty-hero">
          <h1>{session.identity.name}</h1>
          <p>
            Ask the council a question — each member answers independently, then debates across rounds until they
            concur or hit the round cap. A moderator synthesizes the final answer.
          </p>
          <div className="empty-hero-composer">{composer}</div>
        </div>
      ) : (
        <>
          {live ? <CouncilLiveView session={session} live={live} /> : <CouncilTranscript session={session} />}
          {composer}
        </>
      )}
    </div>
  );
}
