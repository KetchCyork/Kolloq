import { computeAlignment, computeTotalCostNote, DEFAULT_COUNCIL_MAX_ROUNDS } from "../councilReducer";
import { useStore } from "../store";
import type { CouncilSession, LiveCouncilTurn } from "../types";
import { colorForSeat, CouncilRoundList } from "./CouncilRoundList";

const FORCE_VOTE_TOOLTIP = "Stop the debate now and have the moderator synthesize from the positions gathered so far.";

/**
 * Live split-view: color-coded transcript (left) + alignment/session status (right rail). Pause,
 * Inject message, and Force vote drive the `Council` engine's mid-debate control hook
 * (`CouncilController` in packages/core/src/agent/council.ts) via the store — disabled only once
 * the turn has finished, since there's nothing left to control.
 */
export function CouncilLiveView({ session, live }: { session: CouncilSession; live: LiveCouncilTurn }) {
  const { accounts, pauseCouncilTurn, resumeCouncilTurn, injectCouncilMessage, forceCouncilVote } = useStore();
  const currentRound = Math.max(0, live.rounds.length - 1);
  const maxRounds = live.maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS;
  const alignment = computeAlignment(live.rounds);
  const costNote = computeTotalCostNote(live.rounds, live.answer, session.members, accounts, session.moderatorAccountId);

  const latestStanceByMember = new Map<string, "concur" | "dissent">();
  for (const round of live.rounds) {
    for (const position of round) {
      if (position.stance) latestStanceByMember.set(position.memberId, position.stance);
    }
  }

  const statusLabel = live.moderatorError
    ? "Moderator error"
    : live.finished
      ? "Drafting Decision Brief…"
      : live.paused
        ? "Paused"
        : live.forcedVote
          ? "Forcing vote…"
          : live.budgetExceeded
            ? "Budget cap reached — drafting Decision Brief…"
            : live.rounds.length === 0
              ? "Starting…"
              : `Round ${currentRound} · ${currentRound === 0 ? "Opening positions" : "Rebuttal & revision"}`;

  function handleInject() {
    const message = window.prompt("Inject a message or additional context for the next round:");
    const trimmed = message?.trim();
    if (trimmed) injectCouncilMessage(session.id, trimmed);
  }

  function handleForceVote() {
    if (window.confirm("Stop the debate now and have the moderator synthesize from the positions gathered so far?")) {
      forceCouncilVote(session.id);
    }
  }

  return (
    <div className="main">
      <div className="chat-header">
        <div className="avatar" style={{ background: session.identity.color }}>
          {session.identity.emoji}
        </div>
        <div className="chat-header-meta">
          <div className="chat-header-name-row">{session.identity.name}</div>
          <div className="chat-header-sub">{live.question}</div>
        </div>
        <span className="badge amber">{statusLabel}</span>
        <button
          type="button"
          className="settings-btn"
          disabled={live.finished || live.forcedVote}
          onClick={() => (live.paused ? resumeCouncilTurn(session.id) : pauseCouncilTurn(session.id))}
        >
          {live.paused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button type="button" className="settings-btn" disabled={live.finished || live.forcedVote} onClick={handleInject}>
          💬 Inject message
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={live.finished || live.forcedVote}
          title={FORCE_VOTE_TOOLTIP}
          onClick={handleForceVote}
        >
          🗳 Force vote
        </button>
      </div>

      <div className="council-layout">
        <div className="council-main">
          <CouncilRoundList rounds={live.rounds} dropped={live.dropped} members={session.members} />
          {live.lastInjectedMessage && !live.finished && (
            <div className="council-live-status">💬 Injected for the next round: “{live.lastInjectedMessage}”</div>
          )}
          {live.moderatorError && (
            <div className="council-answer no-consensus">
              <div className="council-answer-label">Moderator error: {live.moderatorError}</div>
            </div>
          )}
          {!live.moderatorError && live.rounds.length === 0 && <div className="council-live-status">Starting…</div>}
        </div>

        <aside className="council-side">
          <div className="council-side-h">Alignment</div>
          <div className="meter">
            <div style={{ width: `${alignment ?? 0}%` }} />
          </div>
          <div className="hint">
            {alignment === null
              ? "Waiting for round 1 rebuttals — round 0 is independent, nothing to agree on yet."
              : `${alignment}% of round ${currentRound} respondents concur.`}
          </div>

          <div className="council-side-h">Latest stance</div>
          {session.members.map((member, index) => {
            const stance = latestStanceByMember.get(member.id);
            return (
              <div className="council-score-row" key={member.id}>
                <span className="dot" style={{ background: colorForSeat(member.id, session.members) }} />
                {member.role || `Seat ${index + 1}`}
                <span className="val">
                  {stance ? <span className={`badge ${stance === "concur" ? "green" : "amber"}`}>{stance}</span> : "–"}
                </span>
              </div>
            );
          })}

          <div className="council-side-h">Session</div>
          <div className="council-side-kv">
            <span>
              Round <b>{currentRound}</b> of {maxRounds}
            </span>
            <span>
              Cost so far <b>{costNote}</b>
              {session.budgetCap ? ` / $${session.budgetCap.toFixed(2)} cap` : ""}
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}
