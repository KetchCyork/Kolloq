import { useEffect, useRef } from "react";
import { classifyCouncilOutcome, DEFAULT_COUNCIL_MAX_ROUNDS } from "../councilReducer";
import type { CouncilDroppedMember, CouncilMemberPosition, CouncilSession, LiveCouncilTurn } from "../types";

function RoundList({ rounds, dropped }: { rounds: CouncilMemberPosition[][]; dropped: CouncilDroppedMember[] }) {
  return (
    <div className="council-rounds">
      {rounds.map((positions, roundIndex) => (
        <div className="council-round" key={roundIndex}>
          <div className="council-round-label">Round {roundIndex}</div>
          {positions.map((position) => (
            <div className="council-position" key={position.memberId}>
              <div className="council-position-head">
                <span className="council-position-name">{position.label}</span>
                {position.role && <span className="council-position-role">{position.role}</span>}
                {position.stance && <span className={`council-stance-badge ${position.stance}`}>{position.stance}</span>}
                <span className="council-cost-note">{position.costNote}</span>
              </div>
              {position.reason && <div className="council-position-reason">{position.reason}</div>}
              <div className="council-position-content">{position.content}</div>
            </div>
          ))}
          {positions.length === 0 && (
            <div className="council-dropped council-round-empty">
              ⚠ Every member dropped out before responding this round.
            </div>
          )}
          {dropped
            .filter((member) => member.round === roundIndex)
            .map((member) => (
              <div className="council-dropped" key={member.memberId}>
                ⚠ {member.label} dropped after a provider error: {member.error}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

/** One-line summary of why a finished debate stopped, distinguishing a real consensus from the
 * round cap being hit or every member dropping out — all three otherwise look like "no answer". */
function outcomeLabel(
  consensusReached: boolean,
  lastRoundPositionCount: number,
  // Turns recorded before the cap became configurable have no `maxRounds`, and a restored/imported
  // session can still hold them, so fall back rather than printing "after undefined rounds".
  maxRounds: number | undefined,
): string {
  const outcome = classifyCouncilOutcome({ consensusReached, lastRoundPositionCount });
  const cap = maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS;
  switch (outcome) {
    case "consensus":
      return "Consensus reached";
    case "all-dropped":
      return "No answer from any member — best-effort synthesis";
    case "cap-hit":
      return `No consensus after ${cap} round${cap === 1 ? "" : "s"} (round cap) — best-effort synthesis`;
  }
}

export function CouncilTranscript({ session, live }: { session: CouncilSession; live?: LiveCouncilTurn }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [session.turns.length, live?.rounds.length, live?.answer, live?.moderatorError]);

  return (
    <div className="messages council-transcript">
      {session.turns.map((turn) => (
        <div className="council-turn" key={turn.id}>
          <div className="council-question">{turn.question}</div>
          <RoundList rounds={turn.rounds} dropped={turn.dropped} />
          <div className={`council-answer ${turn.consensusReached ? "consensus" : "no-consensus"}`}>
            <div className="council-answer-label">
              {outcomeLabel(turn.consensusReached, turn.rounds.at(-1)?.length ?? 0, turn.maxRounds)}
              {turn.moderatorError ? " · moderator error, fallback summary shown" : ""}
            </div>
            <div className="council-answer-content">{turn.answer}</div>
            <div className="council-cost-note council-total-cost">Total est. cost: {turn.totalCostNote}</div>
          </div>
        </div>
      ))}

      {live && (
        <div className="council-turn council-turn-live">
          <div className="council-question">{live.question}</div>
          {!live.finished && (
            <div className="council-round-progress">
              Round {live.currentRound + 1} of {live.maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS}
            </div>
          )}
          <RoundList rounds={live.rounds} dropped={live.dropped} />
          {live.answer ? (
            <div className={`council-answer ${live.consensusReached ? "consensus" : "no-consensus"}`}>
              <div className="council-answer-label">
                {outcomeLabel(live.consensusReached, live.rounds.at(-1)?.length ?? 0, live.maxRounds)}
              </div>
              <div className="council-answer-content">{live.answer}</div>
            </div>
          ) : live.moderatorError ? (
            <div className="council-answer no-consensus">
              <div className="council-answer-label">Moderator error: {live.moderatorError}</div>
            </div>
          ) : (
            <div className="council-live-status">Debating…</div>
          )}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
