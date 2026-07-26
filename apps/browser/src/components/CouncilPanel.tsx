import { useState } from "react";
import { validateCouncilMembers } from "../councilReducer";
import { confirmDialog } from "../dialogs";
import { useStore } from "../store";
import type { CouncilSession } from "../types";
import { CouncilDecisionBrief } from "./CouncilDecisionBrief";
import { CouncilLiveView } from "./CouncilLiveView";
import { CouncilSetupForm } from "./CouncilSetupForm";
import { CouncilSetupView } from "./CouncilSetupView";
import { CouncilTranscript } from "./CouncilTranscript";

export function CouncilPanel({ session }: { session: CouncilSession }) {
  const { accounts, updateCouncilSession, deleteCouncilSession, askCouncil, councilLive } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [askError, setAskError] = useState<string | null>(null);

  const live = councilLive[session.id];
  const isRunning = Boolean(live);
  const validationError = validateCouncilMembers(session.members, accounts);
  const latestTurn = session.turns.at(-1);

  async function handleAsk(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isRunning || validationError) return;
    setAskError(null);
    setQuestion("");
    try {
      await askCouncil(session.id, trimmed);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : String(error));
    }
  }

  // Live debate takes over the whole panel (split-view) regardless of setup/history state below.
  if (live) {
    return <CouncilLiveView session={session} live={live} />;
  }

  // No completed turn yet: the empty state IS the setup screen (challenge + seats + rules + cost).
  if (!latestTurn) {
    return (
      <CouncilSetupView session={session} onConvene={(text) => void handleAsk(text)} error={askError} busy={isRunning} />
    );
  }

  const composer = (
    <div className="composer council-composer">
      {validationError && (
        <div className="council-setup-error">{validationError} Open "Council setup" to fix it.</div>
      )}
      {askError && <div className="council-setup-error">{askError}</div>}
      <textarea
        placeholder="Ask the council a follow-up…"
        value={question}
        disabled={isRunning || Boolean(validationError)}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void handleAsk(question);
          }
        }}
      />
      <div className="composer-actions">
        <button
          type="button"
          disabled={isRunning || !question.trim() || Boolean(validationError)}
          onClick={() => void handleAsk(question)}
        >
          {isRunning ? "Debating…" : "Ask a follow-up"}
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
          onClick={async () => {
            if (await confirmDialog({ message: `Delete "${session.identity.name}"? This cannot be undone.`, confirmLabel: "Delete", danger: true })) {
              deleteCouncilSession(session.id);
            }
          }}
        >
          Delete
        </button>
      </div>

      {settingsOpen && (
        <div className="settings-panel">
          <CouncilSetupForm session={session} onChange={(patch) => updateCouncilSession(session.id, patch)} />
        </div>
      )}

      <div className="council-main">
        <CouncilDecisionBrief
          session={session}
          turn={latestTurn}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => setTranscriptOpen((open) => !open)}
        />
        {transcriptOpen && <CouncilTranscript session={session} />}
      </div>
      {composer}
    </div>
  );
}
