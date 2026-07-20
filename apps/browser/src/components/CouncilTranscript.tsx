import { useEffect, useRef } from "react";
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
              {turn.consensusReached ? "Consensus reached" : "No consensus — best-effort synthesis"}
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
          <RoundList rounds={live.rounds} dropped={live.dropped} />
          {live.answer ? (
            <div className={`council-answer ${live.consensusReached ? "consensus" : "no-consensus"}`}>
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
