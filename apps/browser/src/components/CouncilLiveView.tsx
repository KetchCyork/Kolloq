import { computeAlignment, computeTotalCostNote } from "../councilReducer";
import { useStore } from "../store";
import type { CouncilSession, LiveCouncilTurn } from "../types";
import { colorForSeat, CouncilRoundList } from "./CouncilRoundList";

const CONTROLS_TOOLTIP =
  "Not yet available — the council engine runs a debate turn to completion and doesn't support mid-run control yet.";

/**
 * Live split-view: color-coded transcript (left) + alignment/session status (right rail). Pause,
 * Inject message, and Force vote are shown per the mockup/product spec but disabled — the
 * `Council` engine (packages/core/src/agent/council.ts) runs a turn start-to-finish with no
 * mid-debate control hook yet, so wiring them for real is follow-up backend work, not a UI gap.
 */
export function CouncilLiveView({ session, live }: { session: CouncilSession; live: LiveCouncilTurn }) {
  const { accounts } = useStore();
  const currentRound = Math.max(0, live.rounds.length - 1);
  const maxRounds = session.maxRounds ?? 4;
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
      : live.rounds.length === 0
        ? "Starting…"
        : `Round ${currentRound} · ${currentRound === 0 ? "Opening positions" : "Rebuttal & revision"}`;

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
        <button type="button" className="settings-btn" disabled title={CONTROLS_TOOLTIP}>
          ⏸ Pause
        </button>
        <button type="button" className="settings-btn" disabled title={CONTROLS_TOOLTIP}>
          💬 Inject message
        </button>
        <button type="button" className="settings-btn" disabled title={CONTROLS_TOOLTIP}>
          🗳 Force vote
        </button>
      </div>

      <div className="council-layout">
        <div className="council-main">
          <CouncilRoundList rounds={live.rounds} dropped={live.dropped} members={session.members} />
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
