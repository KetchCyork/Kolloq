import { useEffect, useRef } from "react";
import { parseDecisionBrief } from "../councilReducer";
import type { CouncilSession, CouncilTurn } from "../types";
import { CouncilRoundList } from "./CouncilRoundList";

const DECISION_BRIEF_SECTION_LABELS = [
  ["recommendation", "Recommendation"],
  ["rationale", "Rationale"],
  ["contention", "Key contention & resolution"],
  ["nextSteps", "Next steps"],
] as const;

/** Same section split CouncilDecisionBrief.tsx renders for the primary card — kept here too so
 * the embedded synthesis box doesn't leak the moderator's literal `**Header:**` markdown when the
 * card above already parsed it out. Falls back to the raw answer when parseDecisionBrief can't
 * find any recognized headers. */
function CouncilAnswerContent({ answer }: { answer: string }) {
  const sections = parseDecisionBrief(answer);
  if (!sections.structured) return <>{answer}</>;
  return (
    <>
      {DECISION_BRIEF_SECTION_LABELS.map(
        ([key, label]) =>
          sections[key] && (
            <div className="council-answer-section" key={key}>
              <div className="council-answer-heading">{label}</div>
              <p>{sections[key]}</p>
            </div>
          ),
      )}
    </>
  );
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
      {session.turns.map((turn: CouncilTurn) => (
        <div className="council-turn" key={turn.id}>
          <div className="council-question">{turn.question}</div>
          <CouncilRoundList rounds={turn.rounds} dropped={turn.dropped} members={session.members} />
          <div className={`council-answer ${turn.consensusReached ? "consensus" : "no-consensus"}`}>
            <div className="council-answer-label">
              {turn.consensusReached ? "Consensus reached" : "No consensus — best-effort synthesis"}
              {turn.moderatorError ? " · moderator error, fallback summary shown" : ""}
            </div>
            <div className="council-answer-content">
              <CouncilAnswerContent answer={turn.answer} />
            </div>
            <div className="council-msg-cost">Total est. cost: {turn.totalCostNote}</div>
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
