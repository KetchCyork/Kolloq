import { useState, type FormEvent } from "react";
import {
  computeAlignment,
  computeTotalCostNote,
  DEFAULT_COUNCIL_MAX_ROUNDS,
  latestRoundAlignment,
} from "../councilReducer";
import { useStore } from "../store";
import type { CouncilSession, LiveCouncilTurn } from "../types";
import { colorForSeat, CouncilRoundList } from "./CouncilRoundList";

const FORCE_VOTE_TOOLTIP = "Stop the debate now and have the moderator synthesize from the positions gathered so far.";

/** Badge color for a 0-10 moderator-judged alignment score: red reads as active disagreement, amber
 * as partial, green as substantially aligned. Thresholds are a UI convenience, not a scoring rule. */
function scoreBadgeClass(score: number): string {
  if (score >= 7) return "green";
  if (score >= 4) return "amber";
  return "red";
}

/**
 * Live split-view: color-coded transcript (left) + alignment/session status (right rail). Pause,
 * Inject message, and Force vote drive the `Council` engine's mid-debate control hook
 * (`CouncilController` in packages/core/src/agent/council.ts) via the store — disabled only once
 * the turn has finished, since there's nothing left to control.
 *
 * Inject/Force-vote use an inline panel rather than window.prompt/window.confirm: the desktop
 * shell's WebKit view has no UI delegate for native dialogs, so they silently no-op there (NEW-81 QA).
 */
export function CouncilLiveView({ session, live }: { session: CouncilSession; live: LiveCouncilTurn }) {
  const { accounts, pauseCouncilTurn, resumeCouncilTurn, injectCouncilMessage, forceCouncilVote } = useStore();
  const [injectDraft, setInjectDraft] = useState<string | null>(null);
  const [confirmingForceVote, setConfirmingForceVote] = useState(false);
  const currentRound = Math.max(0, live.rounds.length - 1);
  const maxRounds = live.maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS;
  const latestAlignment = latestRoundAlignment(live.alignmentScores);
  // Real moderator-judged 0-10 score once round 1's judging call resolves; before that (or if it
  // never resolves for this turn) fall back to the concur/dissent share proxy.
  const alignmentPercent = latestAlignment ? latestAlignment.average * 10 : computeAlignment(live.rounds);
  const costNote = computeTotalCostNote(live.rounds, live.answer, session.members, accounts, session.moderatorAccountId);

  const latestStanceByMember = new Map<string, "concur" | "dissent">();
  for (const round of live.rounds) {
    for (const position of round) {
      if (position.stance) latestStanceByMember.set(position.memberId, position.stance);
    }
  }
  const latestScoreByMember = new Map(latestAlignment?.scores.map((score) => [score.memberId, score]) ?? []);

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

  function handleInjectSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = injectDraft?.trim();
    if (trimmed) injectCouncilMessage(session.id, trimmed);
    setInjectDraft(null);
  }

  function handleForceVoteConfirm() {
    forceCouncilVote(session.id);
    setConfirmingForceVote(false);
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
        <button
          type="button"
          className="settings-btn"
          disabled={live.finished || live.forcedVote}
          onClick={() => {
            setConfirmingForceVote(false);
            setInjectDraft((d) => (d === null ? "" : null));
          }}
        >
          💬 Inject message
        </button>
        <button
          type="button"
          className="settings-btn"
          disabled={live.finished || live.forcedVote}
          title={FORCE_VOTE_TOOLTIP}
          onClick={() => {
            setInjectDraft(null);
            setConfirmingForceVote((c) => !c);
          }}
        >
          🗳 Force vote
        </button>
      </div>

      {injectDraft !== null && !(live.finished || live.forcedVote) && (
        <form className="council-inline-panel" onSubmit={handleInjectSubmit}>
          <input
            autoFocus
            type="text"
            value={injectDraft}
            onChange={(event) => setInjectDraft(event.target.value)}
            placeholder="Inject a message or additional context for the next round…"
          />
          <button type="submit" className="settings-btn" disabled={!injectDraft.trim()}>
            Send
          </button>
          <button type="button" className="settings-btn" onClick={() => setInjectDraft(null)}>
            Cancel
          </button>
        </form>
      )}

      {confirmingForceVote && !(live.finished || live.forcedVote) && (
        <div className="council-inline-panel">
          <span>{FORCE_VOTE_TOOLTIP}</span>
          <button type="button" className="settings-btn" onClick={handleForceVoteConfirm}>
            Confirm force vote
          </button>
          <button type="button" className="settings-btn" onClick={() => setConfirmingForceVote(false)}>
            Cancel
          </button>
        </div>
      )}

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
            <div style={{ width: `${alignmentPercent ?? 0}%` }} />
          </div>
          <div className="hint">
            {latestAlignment
              ? `${latestAlignment.average.toFixed(1)}/10 average alignment — round ${latestAlignment.round} vs. the leading proposal.`
              : alignmentPercent === null
                ? "Waiting for round 1 rebuttals — round 0 is independent, nothing to agree on yet."
                : `${alignmentPercent}% of round ${currentRound} respondents concur.`}
          </div>

          <div className="council-side-h">{latestAlignment ? "Alignment score" : "Latest stance"}</div>
          {session.members.map((member, index) => {
            const score = latestScoreByMember.get(member.id);
            const stance = latestStanceByMember.get(member.id);
            return (
              <div className="council-score-row" key={member.id}>
                <span className="dot" style={{ background: colorForSeat(member.id, session.members) }} />
                {member.role || `Seat ${index + 1}`}
                <span className="val" title={score?.justification}>
                  {score ? (
                    <span className={`badge ${scoreBadgeClass(score.score)}`}>{score.score}/10</span>
                  ) : stance ? (
                    <span className={`badge ${stance === "concur" ? "green" : "amber"}`}>{stance}</span>
                  ) : (
                    "–"
                  )}
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
