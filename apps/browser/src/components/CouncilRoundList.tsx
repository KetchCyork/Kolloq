import type { CouncilDroppedMember, CouncilMemberConfig, CouncilMemberPosition } from "../types";

export const SEAT_COLORS = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--a5)"];

export function colorForSeat(memberId: string, members: CouncilMemberConfig[]): string {
  const index = members.findIndex((member) => member.id === memberId);
  return SEAT_COLORS[index >= 0 ? index % SEAT_COLORS.length : 0]!;
}

/** Color-coded, round-by-round transcript body shared by the live split-view and the historical
 * per-turn transcript — both a running debate and a saved one render the same way. */
export function CouncilRoundList({
  rounds,
  dropped,
  members,
}: {
  rounds: CouncilMemberPosition[][];
  dropped: CouncilDroppedMember[];
  members: CouncilMemberConfig[];
}) {
  return (
    <>
      {rounds.map((positions, roundIndex) => {
        const droppedThisRound = dropped.filter((member) => member.round === roundIndex).length;
        const activeEnteringRound = members.length - dropped.filter((member) => member.round < roundIndex).length;
        const roundComplete = positions.length + droppedThisRound === activeEnteringRound;
        return (
          <div key={roundIndex}>
            <div className="council-round-divider">
              {roundIndex === 0 ? "Round 0 — Opening positions (independent)" : `Round ${roundIndex} — Rebuttal & revision`}
            </div>
            {positions.map((position) => (
              <div className="council-msg" key={position.memberId}>
                <div className="council-msg-who" style={{ background: colorForSeat(position.memberId, members) }}>
                  {position.label.charAt(0).toUpperCase()}
                </div>
                <div className="bubble" style={{ flex: 1 }}>
                  <div className="council-msg-meta">
                    <b>{position.label}</b>
                    {position.role ? ` · ${position.role}` : ""}
                    {position.stance && (
                      <span className="council-msg-badges">
                        <span className={`badge ${position.stance === "concur" ? "green" : "amber"}`}>{position.stance}</span>
                      </span>
                    )}
                    <span className="council-msg-cost">{position.costNote}</span>
                  </div>
                  {position.reason && <div className="council-msg-reason">{position.reason}</div>}
                  <div className="council-msg-body">{position.content}</div>
                </div>
              </div>
            ))}
            {positions.length === 0 && droppedThisRound > 0 && roundComplete && (
              <div className="council-dropped">⚠ Every member dropped out before responding this round.</div>
            )}
            {dropped
              .filter((member) => member.round === roundIndex)
              .map((member) => (
                <div className="council-dropped" key={member.memberId}>
                  ⚠ {member.label} dropped after a provider error: {member.error}
                </div>
              ))}
          </div>
        );
      })}
    </>
  );
}
