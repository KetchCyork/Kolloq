import type { CouncilEvent } from "@newvector/core";
import { describe, expect, it } from "vitest";
import {
  applyCouncilEvent,
  classifyCouncilOutcome,
  computeTotalCostNote,
  initialLiveCouncilTurn,
  MAX_COUNCIL_MEMBERS,
  MIN_COUNCIL_MEMBERS,
  validateCouncilMembers,
} from "./councilReducer";
import type { Account, CouncilMemberConfig } from "./types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: overrides.id ?? "acct-1",
    provider: overrides.provider ?? "anthropic",
    label: overrides.label ?? "Work Anthropic",
    model: overrides.model ?? "claude-3-5-sonnet-20241022",
    createdAt: overrides.createdAt ?? 0,
    ...overrides,
  };
}

describe("validateCouncilMembers", () => {
  const accounts = [account({ id: "a1" }), account({ id: "a2", provider: "openai", label: "OpenAI" })];

  it(`rejects fewer than ${MIN_COUNCIL_MEMBERS} members`, () => {
    const members: CouncilMemberConfig[] = [{ id: "m1", accountId: "a1" }];
    expect(validateCouncilMembers(members, accounts)).toMatch(/at least 2/);
  });

  it(`rejects more than ${MAX_COUNCIL_MEMBERS} members`, () => {
    const members: CouncilMemberConfig[] = Array.from({ length: 6 }, (_, i) => ({
      id: `m${i}`,
      accountId: i % 2 === 0 ? "a1" : "a2",
    }));
    expect(validateCouncilMembers(members, accounts)).toMatch(/at most 5/);
  });

  it("rejects a member whose account no longer exists", () => {
    const members: CouncilMemberConfig[] = [
      { id: "m1", accountId: "a1" },
      { id: "m2", accountId: "missing" },
    ];
    expect(validateCouncilMembers(members, accounts)).toMatch(/no longer exists/);
  });

  it("rejects two members sharing the same account", () => {
    const members: CouncilMemberConfig[] = [
      { id: "m1", accountId: "a1" },
      { id: "m2", accountId: "a1" },
    ];
    expect(validateCouncilMembers(members, accounts)).toMatch(/different account/);
  });

  it("accepts a valid 2-5 member roster on distinct accounts", () => {
    const members: CouncilMemberConfig[] = [
      { id: "m1", accountId: "a1", role: "skeptic" },
      { id: "m2", accountId: "a2" },
    ];
    expect(validateCouncilMembers(members, accounts)).toBeNull();
  });
});

describe("applyCouncilEvent", () => {
  const accounts = [
    account({ id: "a1", provider: "anthropic", label: "Claude", model: "claude-3-5-sonnet-20241022" }),
    account({ id: "a2", provider: "openai", label: "GPT", model: "gpt-4o-mini" }),
  ];
  const members: CouncilMemberConfig[] = [
    { id: "m1", accountId: "a1", role: "skeptic" },
    { id: "m2", accountId: "a2" },
  ];

  it("builds up rounds from round-start and member-position events, with resolved labels and cost notes", () => {
    let turn = initialLiveCouncilTurn("Should we do X?", 4);
    const events: CouncilEvent[] = [
      { type: "round-start", round: 0 },
      { type: "member-position", round: 0, position: { member: "m1", role: "skeptic", content: "Answer A0" } },
      { type: "member-position", round: 0, position: { member: "m2", content: "Answer B0" } },
    ];
    for (const event of events) turn = applyCouncilEvent(turn, event, members, accounts);

    expect(turn.rounds).toHaveLength(1);
    expect(turn.rounds[0]).toEqual([
      { memberId: "m1", label: "Claude · claude-3-5-sonnet-20241022", role: "skeptic", content: "Answer A0", costNote: "~3 tok · ~$0.0000" },
      { memberId: "m2", label: "GPT · gpt-4o-mini", role: undefined, content: "Answer B0", costNote: "~3 tok · ~$0.0000" },
    ]);
    expect(turn.finished).toBe(false);
    expect(turn.currentRound).toBe(0);
    expect(turn.maxRounds).toBe(4);
  });

  it("records a dropped member with its resolved label", () => {
    let turn = initialLiveCouncilTurn("Q", 4);
    turn = applyCouncilEvent(turn, { type: "round-start", round: 1 }, members, accounts);
    turn = applyCouncilEvent(turn, { type: "member-dropped", round: 1, member: "m1", error: "boom" }, members, accounts);

    expect(turn.dropped).toEqual([{ memberId: "m1", label: "Claude · claude-3-5-sonnet-20241022", round: 1, error: "boom" }]);
  });

  it("marks consensusReached on a consensus event without finishing the turn", () => {
    let turn = initialLiveCouncilTurn("Q", 4);
    turn = applyCouncilEvent(turn, { type: "consensus", round: 1 }, members, accounts);
    expect(turn.consensusReached).toBe(true);
    expect(turn.finished).toBe(false);
  });

  it("finishes the turn on moderator-synthesis, storing the answer", () => {
    let turn = initialLiveCouncilTurn("Q", 4);
    turn = applyCouncilEvent(turn, { type: "moderator-synthesis", content: "Final answer" }, members, accounts);
    expect(turn.answer).toBe("Final answer");
    expect(turn.finished).toBe(true);
  });

  it("finishes the turn on moderator-error without discarding prior rounds", () => {
    let turn = initialLiveCouncilTurn("Q", 4);
    turn = applyCouncilEvent(turn, { type: "round-start", round: 0 }, members, accounts);
    turn = applyCouncilEvent(
      turn,
      { type: "member-position", round: 0, position: { member: "m1", content: "A0" } },
      members,
      accounts,
    );
    turn = applyCouncilEvent(turn, { type: "moderator-error", error: "moderator down" }, members, accounts);

    expect(turn.moderatorError).toBe("moderator down");
    expect(turn.finished).toBe(true);
    expect(turn.rounds[0]).toHaveLength(1);
  });
});

describe("classifyCouncilOutcome", () => {
  it("returns consensus when the debate reached unanimous concurrence", () => {
    expect(classifyCouncilOutcome({ consensusReached: true, lastRoundPositionCount: 2 })).toBe("consensus");
  });

  it("returns all-dropped when the final round has zero positions", () => {
    expect(classifyCouncilOutcome({ consensusReached: false, lastRoundPositionCount: 0 })).toBe("all-dropped");
  });

  it("returns cap-hit when the debate ended without consensus but members still responded", () => {
    expect(classifyCouncilOutcome({ consensusReached: false, lastRoundPositionCount: 2 })).toBe("cap-hit");
  });
});

describe("computeTotalCostNote", () => {
  const accounts = [account({ id: "a1", provider: "ollama", label: "Local", model: "llama3.1" })];
  const members: CouncilMemberConfig[] = [{ id: "m1", accountId: "a1" }];

  it("sums position and answer cost into one note", () => {
    const rounds = [[{ memberId: "m1", label: "Local · llama3.1", content: "a".repeat(40), costNote: "" }]];
    const note = computeTotalCostNote(rounds, "b".repeat(40), members, accounts);
    expect(note).toBe("~20 tok · free (local)");
  });

  it("omits the answer contribution when there is no answer yet", () => {
    const rounds = [[{ memberId: "m1", label: "Local · llama3.1", content: "a".repeat(40), costNote: "" }]];
    const note = computeTotalCostNote(rounds, undefined, members, accounts);
    expect(note).toBe("~10 tok · free (local)");
  });
});
