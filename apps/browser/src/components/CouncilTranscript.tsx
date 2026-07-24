import { useEffect, useRef } from "react";
import { classifyCouncilOutcome, DEFAULT_COUNCIL_MAX_ROUNDS } from "../councilReducer";
import type { CouncilSession } from "../types";
import { CouncilRoundList } from "./CouncilRoundList";

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
              {outcomeLabel(turn.consensusReached, turn.rounds.at(-1)?.length ?? 0, turn.maxRounds)}
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
