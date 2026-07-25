import { classifyCouncilOutcome, DEFAULT_COUNCIL_MAX_ROUNDS, parseDecisionBrief } from "../councilReducer";
import type { CouncilSession, CouncilTurn } from "../types";

/** One-line summary of why a finished debate stopped, distinguishing a real consensus from the
 * round cap being hit or every member dropping out — all three otherwise look like "no consensus". */
function outcomeLabel(turn: CouncilTurn): string {
  const outcome = classifyCouncilOutcome({
    consensusReached: turn.consensusReached,
    lastRoundPositionCount: turn.rounds.at(-1)?.length ?? 0,
    budgetExceeded: turn.budgetExceeded,
  });
  // Turns recorded before the cap became configurable have no `maxRounds`, so fall back rather
  // than printing "after undefined rounds".
  const cap = turn.maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS;
  switch (outcome) {
    case "consensus":
      return "Consensus reached";
    case "all-dropped":
      return "No answer from any member — best-effort synthesis";
    case "budget-cap-hit":
      return "Budget cap reached — best-effort synthesis";
    case "cap-hit":
      return `No consensus after ${cap} round${cap === 1 ? "" : "s"} (round cap) — best-effort synthesis`;
  }
}

function buildMarkdown(turn: CouncilTurn): string {
  const sections = parseDecisionBrief(turn.answer);
  const finalPositions = turn.rounds.at(-1) ?? [];
  const dissenting = finalPositions.filter((position) => position.stance === "dissent");

  const lines = [`# Decision Brief: ${turn.question}`, ""];
  if (sections.structured) {
    if (sections.recommendation) lines.push("## Recommendation", sections.recommendation, "");
    if (sections.rationale) lines.push("## Rationale", sections.rationale, "");
    if (sections.contention) lines.push("## Key contention & resolution", sections.contention, "");
    if (sections.nextSteps) lines.push("## Next steps", sections.nextSteps, "");
  } else {
    lines.push("## Recommendation", turn.answer, "");
  }
  if (dissenting.length > 0) {
    lines.push(
      "## Dissents & reservations",
      ...dissenting.map((position) => `- **${position.label}:** ${position.reason ?? "no reason given"}`),
      "",
    );
  }
  lines.push(`Total est. cost: ${turn.totalCostNote}`);
  return lines.join("\n");
}

function downloadMarkdown(turn: CouncilTurn) {
  const blob = new Blob([buildMarkdown(turn)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `decision-brief-${new Date(turn.createdAt).toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The Decision Brief for one finished turn. `answer` is the moderator's plain-text synthesis;
 * `parseDecisionBrief` best-effort splits it into named sections (the moderator is asked to use
 * those headers — see `DECISION_BRIEF_FORMAT` in council.ts — but nothing enforces it), falling
 * back to rendering the raw answer under "Recommendation" when it doesn't comply. Dissents and
 * dropped seats are real structured data from the transcript, not parsed from prose.
 */
export function CouncilDecisionBrief({
  session,
  turn,
  transcriptOpen,
  onToggleTranscript,
}: {
  session: CouncilSession;
  turn: CouncilTurn;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
}) {
  const sections = parseDecisionBrief(turn.answer);
  const finalPositions = turn.rounds.at(-1) ?? [];
  const dissenting = finalPositions.filter((position) => position.stance === "dissent");
  const label = turn.moderatorError ? "Moderator error — fallback summary" : outcomeLabel(turn);

  return (
    <div className="council-brief">
      <span className={`badge ${turn.consensusReached ? "green" : "amber"}`}>
        {label} · Round {turn.finalRound} of {turn.maxRounds || DEFAULT_COUNCIL_MAX_ROUNDS} · {turn.totalCostNote}
      </span>
      <h3 className="serif">{turn.question}</h3>
      <div className="council-brief-meta">
        {session.members.length}-seat council · {new Date(turn.createdAt).toLocaleDateString()}
      </div>

      {sections.structured ? (
        <>
          {sections.recommendation && (
            <>
              <h4>Recommendation</h4>
              <p>{sections.recommendation}</p>
            </>
          )}
          {sections.rationale && (
            <>
              <h4>Rationale</h4>
              <p>{sections.rationale}</p>
            </>
          )}
          {sections.contention && (
            <>
              <h4>Key contention & resolution</h4>
              <p>{sections.contention}</p>
            </>
          )}
          {sections.nextSteps && (
            <>
              <h4>Next steps</h4>
              <p>{sections.nextSteps}</p>
            </>
          )}
        </>
      ) : (
        <>
          <h4>Recommendation</h4>
          <p>{turn.answer}</p>
        </>
      )}

      {dissenting.length > 0 && (
        <>
          <h4>Dissents & reservations</h4>
          {dissenting.map((position) => (
            <div className="council-brief-dissent" key={position.memberId}>
              <b>{position.label}:</b> {position.reason ?? "no reason given"}
            </div>
          ))}
        </>
      )}

      {turn.dropped.length > 0 && (
        <>
          <h4>Dropped seats</h4>
          <p>{turn.dropped.map((member) => `${member.label} (round ${member.round}: ${member.error})`).join("; ")}</p>
        </>
      )}

      <div className="council-brief-actions">
        <button type="button" className="settings-btn" onClick={() => downloadMarkdown(turn)}>
          Export Markdown
        </button>
        <button type="button" className="settings-btn" onClick={onToggleTranscript}>
          {transcriptOpen ? "Hide full transcript" : "View full debate transcript →"}
        </button>
      </div>
    </div>
  );
}
