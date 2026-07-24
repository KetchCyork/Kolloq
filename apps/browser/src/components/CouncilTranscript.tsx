import { useEffect, useRef } from "react";
import type { CouncilSession } from "../types";
import { CouncilRoundList } from "./CouncilRoundList";

/** Full round-by-round history for every turn in a session — used to expand "View full debate
 * transcript" under the latest turn's Decision Brief. Scrolls itself to the bottom on mount since
 * it's typically revealed after the brief, further down the page. */
export function CouncilTranscript({ session }: { session: CouncilSession }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [session.turns.length]);

  return (
    <div className="council-transcript">
      {session.turns.map((turn) => (
        <div className="council-turn" key={turn.id}>
          <div className="council-question">{turn.question}</div>
          <CouncilRoundList rounds={turn.rounds} dropped={turn.dropped} members={session.members} />
          <div className={`council-answer ${turn.consensusReached ? "consensus" : "no-consensus"}`}>
            <div className="council-answer-label">
              {turn.consensusReached ? "Consensus reached" : "No consensus — best-effort synthesis"}
              {turn.moderatorError ? " · moderator error, fallback summary shown" : ""}
            </div>
            <div className="council-answer-content">{turn.answer}</div>
            <div className="council-msg-cost">Total est. cost: {turn.totalCostNote}</div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
