import type { CouncilEvent } from "@newvector/core";
import { describe, expect, it } from "vitest";
import {
  applyCouncilEvent,
  classifyCouncilOutcome,
  computeAlignment,
  computeTotalCostNote,
  diversityHint,
  estimateCouncilCostRange,
  initialLiveCouncilTurn,
  MAX_COUNCIL_MEMBERS,
  MIN_COUNCIL_MEMBERS,
  parseDecisionBrief,
  validateCouncilMembers,
} from "./councilReducer";
import type { Account, CouncilMemberConfig, CouncilMemberPosition } from "./types";

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
      { type: "member-position", round: 0, position: { member: "m1", label: "m1", role: "skeptic", content: "Answer A0" } },
      { type: "member-position", round: 0, position: { member: "m2", label: "m2", content: "Answer B0" } },
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
    turn = applyCouncilEvent(
      turn,
      { type: "member-dropped", round: 1, member: "m1", label: "Claude · claude-3-5-sonnet-20241022", error: "boom" },
      members,
      accounts,
    );

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
      { type: "member-position", round: 0, position: { member: "m1", label: "m1", content: "A0" } },
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

  it("prices the answer using the explicit moderator account when given", () => {
    const withModerator = [
      account({ id: "a1", provider: "ollama", label: "Local", model: "llama3.1" }),
      account({ id: "a2", provider: "anthropic", label: "Claude", model: "claude-3-5-sonnet-20241022" }),
    ];
    const rounds = [[{ memberId: "m1", label: "Local · llama3.1", content: "a".repeat(40), costNote: "" }]];
    const note = computeTotalCostNote(rounds, "b".repeat(40), members, withModerator, "a2");
    // Answer priced against a2 (anthropic, paid) rather than falling back to members[0]'s a1 (free/local).
    expect(note).not.toContain("free (local)");
  });
});

describe("diversityHint", () => {
  const anthropic = account({ id: "a1", provider: "anthropic" });
  const openai = account({ id: "a2", provider: "openai" });
  const anthropic2 = account({ id: "a3", provider: "anthropic" });

  it("returns null with fewer than 2 members", () => {
    expect(diversityHint([{ id: "m1", accountId: "a1" }], [anthropic])).toBeNull();
  });

  it("flags a roster that's all the same provider", () => {
    const members: CouncilMemberConfig[] = [
      { id: "m1", accountId: "a1" },
      { id: "m2", accountId: "a3" },
    ];
    expect(diversityHint(members, [anthropic, anthropic2])).toMatch(/same provider/);
  });

  it("praises a diverse roster", () => {
    const members: CouncilMemberConfig[] = [
      { id: "m1", accountId: "a1" },
      { id: "m2", accountId: "a2" },
    ];
    expect(diversityHint(members, [anthropic, openai])).toMatch(/Good model diversity — 2 providers/);
  });
});

describe("estimateCouncilCostRange", () => {
  it("reports free for an all-local roster", () => {
    const accounts = [account({ id: "a1", provider: "ollama" })];
    const members: CouncilMemberConfig[] = [{ id: "m1", accountId: "a1" }];
    const estimate = estimateCouncilCostRange(members, accounts, 4);
    expect(estimate.allFree).toBe(true);
    expect(estimate.lowUsd).toBe(0);
    expect(estimate.highUsd).toBe(0);
  });

  it("scales the high estimate with maxRounds and prices the low estimate at roughly half", () => {
    const accounts = [account({ id: "a1", provider: "anthropic" })];
    const members: CouncilMemberConfig[] = [{ id: "m1", accountId: "a1" }];
    const estimate = estimateCouncilCostRange(members, accounts, 4);
    expect(estimate.allFree).toBe(false);
    expect(estimate.highUsd).toBeGreaterThan(estimate.lowUsd);
    expect(estimate.lowUsd).toBeGreaterThan(0);
  });
});

describe("computeAlignment", () => {
  function position(overrides: Partial<CouncilMemberPosition>): CouncilMemberPosition {
    return { memberId: "m", label: "M", content: "x", costNote: "", ...overrides };
  }

  it("returns null before any round has a stance (round 0 is independent answers)", () => {
    expect(computeAlignment([[position({ memberId: "m1" }), position({ memberId: "m2" })]])).toBeNull();
  });

  it("returns the percentage of the latest round that concurred", () => {
    const rounds = [
      [position({ memberId: "m1" }), position({ memberId: "m2" })],
      [position({ memberId: "m1", stance: "concur" }), position({ memberId: "m2", stance: "dissent" })],
    ];
    expect(computeAlignment(rounds)).toBe(50);
  });

  it("reads only the latest round, not earlier ones", () => {
    const rounds = [
      [position({ memberId: "m1" })],
      [position({ memberId: "m1", stance: "dissent" })],
      [position({ memberId: "m1", stance: "concur" })],
    ];
    expect(computeAlignment(rounds)).toBe(100);
  });
});

describe("parseDecisionBrief", () => {
  it("splits a well-formed brief into its sections", () => {
    const answer = [
      "Recommendation:",
      "Buy Stripe Billing.",
      "Rationale:",
      "Cheaper and faster.",
      "Key contention & resolution:",
      "Critic conceded on TCO.",
      "Next steps:",
      "Spike the migration.",
    ].join("\n");

    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.recommendation).toBe("Buy Stripe Billing.");
    expect(sections.rationale).toBe("Cheaper and faster.");
    expect(sections.contention).toBe("Critic conceded on TCO.");
    expect(sections.nextSteps).toBe("Spike the migration.");
  });

  it("falls back to unstructured when no recognized headers are present", () => {
    const sections = parseDecisionBrief("Just go with Stripe, it's cheaper.");
    expect(sections.structured).toBe(false);
    expect(sections.recommendation).toBeUndefined();
  });

  it("tolerates missing sections and out-of-order headers", () => {
    const answer = "Rationale:\nBecause it's cheaper.\nRecommendation:\nBuy Stripe.";
    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.rationale).toBe("Because it's cheaper.");
    expect(sections.recommendation).toBe("Buy Stripe.");
    expect(sections.contention).toBeUndefined();
  });

  it("strips bold markdown wrapping the headers instead of leaking ** into section content", () => {
    const answer = [
      "**Recommendation:**",
      "Buy Stripe Billing.",
      "**Rationale:**",
      "Cheaper and faster.",
      "**Key contention & resolution:**",
      "Critic conceded on TCO.",
      "**Next steps:**",
      "Spike the migration.",
    ].join("\n");

    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.recommendation).toBe("Buy Stripe Billing.");
    expect(sections.rationale).toBe("Cheaper and faster.");
    expect(sections.contention).toBe("Critic conceded on TCO.");
    expect(sections.nextSteps).toBe("Spike the migration.");
    for (const value of Object.values(sections)) {
      if (typeof value === "string") expect(value).not.toContain("**");
    }
  });

  it("strips quote-wrapped headers instead of leaking \" into section content", () => {
    const answer = [
      '"Recommendation:"',
      "Buy Stripe Billing.",
      '"Rationale:"',
      "Cheaper and faster.",
    ].join("\n");

    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.recommendation).toBe("Buy Stripe Billing.");
    expect(sections.rationale).toBe("Cheaper and faster.");
    for (const value of Object.values(sections)) {
      if (typeof value === "string") expect(value).not.toContain('"');
    }
  });

  it("drops a stray bare-decoration line left over from an asymmetric wrapper", () => {
    const answer = [
      "**Recommendation:",
      "Buy Stripe Billing.",
      "**",
      "**Rationale:",
      "Cheaper and faster.",
    ].join("\n");

    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.recommendation).toBe("Buy Stripe Billing.");
    expect(sections.rationale).toBe("Cheaper and faster.");
  });

  it("drops a stray decoration line even when a blank line pads it from the next header", () => {
    const answer = [
      '"Recommendation:"',
      "Buy Stripe Billing over building in-house.",
      "",
      "**Rationale:",
      "Cheaper and faster to ship; team lacks billing-domain expertise.",
      "**",
      "",
      "_Key contention & resolution:_",
      "One member argued for in-house control; resolved in favor of speed to market.",
    ].join("\n");

    const sections = parseDecisionBrief(answer);
    expect(sections.structured).toBe(true);
    expect(sections.rationale).toBe(
      "Cheaper and faster to ship; team lacks billing-domain expertise.",
    );
    for (const value of Object.values(sections)) {
      if (typeof value === "string") expect(value).not.toContain("**");
    }
  });
});
