import { describe, expect, it } from "vitest";
import type { ChatProvider, ChatRequest, ChatResponse, StreamEvent } from "../providers/types.js";
import { Council, CouncilController, type CouncilEvent } from "./council.js";

/** Deterministic fixed-playback provider — one instance per council member, no live/paid API calls. */
class StubProvider implements ChatProvider {
  readonly model = "stub-model";
  private step = 0;

  readonly requests: ChatRequest[] = [];

  constructor(
    readonly id: string,
    private readonly responses: string[],
  ) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    this.requests.push(request);
    const content = this.responses[this.step];
    this.step += 1;
    if (content === undefined) throw new Error(`${this.id}: no more scripted responses`);
    if (content === "__throw__") throw new Error(`${this.id} provider error`);
    return { finishReason: "stop", message: { role: "assistant", content } };
  }

  async *stream(_request: ChatRequest): AsyncIterable<StreamEvent> {
    throw new Error("not used by council tests");
  }
}

describe("Council", () => {
  it("rejects fewer than 2 or more than 5 members", () => {
    const member = { name: "solo", provider: new StubProvider("solo", []) };
    expect(() => new Council({ members: [member] })).toThrow(/between 2 and 5/);

    const sixMembers = Array.from({ length: 6 }, (_, i) => ({
      name: `m${i}`,
      provider: new StubProvider(`m${i}`, []),
    }));
    expect(() => new Council({ members: sixMembers })).toThrow(/between 2 and 5/);
  });

  it("ends early on unanimous concurrence and synthesizes via the first member's provider", async () => {
    const providerA = new StubProvider("A", ["Answer A0", "CONCUR I agree with B", "Final synthesized answer"]);
    const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);

    const events: CouncilEvent[] = [];
    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    expect(result.consensusReached).toBe(true);
    expect(result.finalRound).toBe(1);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[0]).toEqual([
      { member: "A", label: "A", content: "Answer A0" },
      { member: "B", label: "B", content: "Answer B0" },
    ]);
    expect(result.rounds[1]).toEqual([
      { member: "A", label: "A", content: "I agree with B", stance: "concur" },
      { member: "B", label: "B", content: "sounds good", stance: "concur" },
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.answer).toBe("Final synthesized answer");

    expect(events.some((event) => event.type === "consensus" && event.round === 1)).toBe(true);
    expect(events.some((event) => event.type === "moderator-synthesis")).toBe(true);
  });

  it("stops at the hard round cap when members keep dissenting, and reports the dissent to the moderator", async () => {
    const providerA = new StubProvider("A", [
      "Answer A0",
      "DISSENT: not convinced\nStill think X is risky",
      "Best-effort synthesis noting dissent",
    ]);
    const providerB = new StubProvider("B", ["Answer B0", "DISSENT: prefer Y\nY is safer"]);

    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      maxRounds: 2,
    });

    const result = await council.run("Should we do X?");

    expect(result.consensusReached).toBe(false);
    expect(result.finalRound).toBe(1);
    expect(result.rounds).toHaveLength(2);
    expect(result.rounds[1]).toEqual([
      { member: "A", label: "A", content: "Still think X is risky", stance: "dissent", reason: "not convinced" },
      { member: "B", label: "B", content: "Y is safer", stance: "dissent", reason: "prefer Y" },
    ]);
    expect(result.answer).toBe("Best-effort synthesis noting dissent");
  });

  it("drops a member whose provider errors mid-debate and continues the council with the rest", async () => {
    const providerA = new StubProvider("A", ["A initial", "__throw__", "A synthesis final answer"]);
    const providerB = new StubProvider("B", [
      "B initial",
      "DISSENT: still unsure\nB's dissenting position",
      "CONCUR B's final position",
    ]);

    const events: CouncilEvent[] = [];
    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      maxRounds: 3,
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    expect(result.dropped).toEqual([{ member: "A", label: "A", round: 1, error: "A provider error" }]);
    // Round 1 has only B (A dropped); round 2 is B alone concurring, which is a unanimous (of one) consensus.
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds[1]).toEqual([
      { member: "B", label: "B", content: "B's dissenting position", stance: "dissent", reason: "still unsure" },
    ]);
    expect(result.consensusReached).toBe(true);
    expect(result.finalRound).toBe(2);
    // Moderator is still the first member (A)'s provider, even though A dropped out of the debate itself.
    expect(result.answer).toBe("A synthesis final answer");

    expect(events.some((event) => event.type === "member-dropped" && event.member === "A" && event.round === 1)).toBe(
      true,
    );
  });

  it("falls back to a deterministic summary (without discarding the completed debate) when the moderator's own provider errors", async () => {
    const providerA = new StubProvider("A", ["Answer A0", "CONCUR I agree with B", "__throw__"]);
    const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);

    const events: CouncilEvent[] = [];
    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    // The debate itself completed and reached consensus — a moderator failure must not throw that away.
    expect(result.consensusReached).toBe(true);
    expect(result.rounds).toHaveLength(2);
    expect(result.moderatorError).toBe("A provider error");
    expect(result.answer).toContain("moderator's provider errored");
    expect(result.answer).toContain("A: I agree with B");
    expect(result.answer).toContain("B: sounds good");

    expect(events.some((event) => event.type === "moderator-error" && event.error === "A provider error")).toBe(true);
    expect(events.some((event) => event.type === "moderator-synthesis")).toBe(false);
  });

  it("surfaces each member's configured role in prompts and in the returned positions", async () => {
    const providerA = new StubProvider("A", ["Answer A0", "CONCUR I agree with B", "Final synthesized answer"]);
    const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);

    const council = new Council({
      members: [
        { name: "A", provider: providerA, role: "skeptic" },
        { name: "B", provider: providerB, role: "domain expert" },
      ],
    });

    const result = await council.run("Should we do X?");

    expect(result.rounds[0]).toEqual([
      { member: "A", label: "A", role: "skeptic", content: "Answer A0" },
      { member: "B", label: "B", role: "domain expert", content: "Answer B0" },
    ]);
    expect(result.rounds[1]).toEqual([
      { member: "A", label: "A", role: "skeptic", content: "I agree with B", stance: "concur" },
      { member: "B", label: "B", role: "domain expert", content: "sounds good", stance: "concur" },
    ]);
  });

  it("treats a reply with no explicit CONCUR/DISSENT marker as a (silent) dissent", async () => {
    const providerA = new StubProvider("A", ["A0", "I'm not sure, maybe both are fine", "moderator answer"]);
    const providerB = new StubProvider("B", ["B0", "CONCUR agreed"]);

    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      maxRounds: 2,
    });

    const result = await council.run("Q");

    expect(result.consensusReached).toBe(false);
    expect(result.rounds[1]?.[0]).toEqual({
      member: "A",
      label: "A",
      content: "I'm not sure, maybe both are fine",
      stance: "dissent",
      reason: "no explicit stance given",
    });
  });

  it("uses an explicit non-debating moderator when provided, instead of members[0]", async () => {
    const providerA = new StubProvider("A", ["Answer A0", "CONCUR I agree with B"]);
    const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);
    const moderatorProvider = new StubProvider("Mod", ["Recommendation: do X"]);

    const events: CouncilEvent[] = [];
    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      moderator: { name: "Moderator", provider: moderatorProvider },
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    // The moderator's provider only ever receives one call (the synthesis) — it never debates.
    expect(result.rounds.flat().map((position) => position.member)).toEqual(["A", "B", "A", "B"]);
    expect(result.answer).toBe("Recommendation: do X");
    expect(events.some((event) => event.type === "moderator-synthesis")).toBe(true);
  });

  it("never embeds a member's opaque id in prompt/transcript text — only its label", async () => {
    const idA = "11111111-1111-1111-1111-111111111111";
    const idB = "22222222-2222-2222-2222-222222222222";
    const providerA = new StubProvider(idA, [
      "Answer A0",
      "DISSENT: not convinced\nStill think X is risky",
      "Final synthesized answer",
    ]);
    const providerB = new StubProvider(idB, ["Answer B0", "DISSENT: prefer Y\nY is safer"]);

    const council = new Council({
      members: [
        { name: idA, label: "Skeptic Bot", provider: providerA },
        { name: idB, label: "Optimist Bot", provider: providerB },
      ],
      maxRounds: 2,
    });

    await council.run("Should we do X?");

    const allRequestText = [...providerA.requests, ...providerB.requests]
      .flatMap((request) => request.messages.map((message) => message.content))
      .join("\n");

    expect(allRequestText).not.toContain(idA);
    expect(allRequestText).not.toContain(idB);
    expect(allRequestText).toContain("Skeptic Bot");
    expect(allRequestText).toContain("Optimist Bot");
  });

  it("reports a dropped member's label separately from its opaque id, and keeps the id out of the moderator prompt", async () => {
    const idA = "aaaaaaaa-0000-0000-0000-000000000000";
    const idB = "bbbbbbbb-0000-0000-0000-000000000000";
    // The stub's own debug id is deliberately unrelated to the council member id: a real provider's
    // error message (rate limit, auth failure, etc.) never contains the caller's account/member id.
    const providerA = new StubProvider("provider-a", ["A initial", "__throw__", "A synthesis final answer"]);
    const providerB = new StubProvider("provider-b", [
      "B initial",
      "DISSENT: still unsure\nB's dissenting position",
      "CONCUR B's final position",
    ]);

    const events: CouncilEvent[] = [];
    const council = new Council({
      members: [
        { name: idA, label: "Claude · Skeptic", provider: providerA },
        { name: idB, label: "GPT · Optimist", provider: providerB },
      ],
      maxRounds: 3,
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    expect(result.dropped).toEqual([
      { member: idA, label: "Claude · Skeptic", round: 1, error: "provider-a provider error" },
    ]);
    const droppedEvent = events.find((event) => event.type === "member-dropped");
    expect(droppedEvent).toMatchObject({ member: idA, label: "Claude · Skeptic" });

    const moderatorPromptText = providerA.requests
      .at(-1)!
      .messages.map((message) => message.content)
      .join("\n");
    expect(moderatorPromptText).not.toContain(idA);
    expect(moderatorPromptText).not.toContain(idB);
    expect(moderatorPromptText).toContain("Claude · Skeptic");
  });

  describe("CouncilController", () => {
    it("halts the debate at the next checkpoint until resume() is called", async () => {
      const providerA = new StubProvider("A", ["Answer A0", "CONCUR agree", "Final synthesized answer"]);
      const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);

      const events: CouncilEvent[] = [];
      const council = new Council({
        members: [
          { name: "A", provider: providerA },
          { name: "B", provider: providerB },
        ],
        onEvent: (event) => events.push(event),
      });

      const controller = new CouncilController();
      controller.pause();
      const resultPromise = council.run("Should we do X?", controller);

      // Let the run loop reach the pre-round-0 checkpoint and start waiting on resume().
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(events.some((event) => event.type === "paused")).toBe(true);
      expect(providerA.requests).toHaveLength(0);
      expect(providerB.requests).toHaveLength(0);

      controller.resume();
      const result = await resultPromise;

      expect(events.some((event) => event.type === "resumed")).toBe(true);
      expect(result.consensusReached).toBe(true);
      expect(result.answer).toBe("Final synthesized answer");
    });

    it("delivers an injected message to every surviving member's next-round prompt", async () => {
      const providerA = new StubProvider("A", ["Answer A0", "CONCUR agree", "Final synthesized answer"]);
      const providerB = new StubProvider("B", ["Answer B0", "CONCUR sounds good"]);

      const events: CouncilEvent[] = [];
      const council = new Council({
        members: [
          { name: "A", provider: providerA },
          { name: "B", provider: providerB },
        ],
        onEvent: (event) => events.push(event),
      });

      const controller = new CouncilController();
      controller.inject("Consider the budget constraint.");
      const result = await council.run("Should we do X?", controller);

      const round0PromptA = providerA.requests[0]!.messages.map((message) => message.content).join("\n");
      const round0PromptB = providerB.requests[0]!.messages.map((message) => message.content).join("\n");
      expect(round0PromptA).toContain("Consider the budget constraint.");
      expect(round0PromptB).toContain("Consider the budget constraint.");

      // Consumed once, at the round it was injected for — not repeated into round 1.
      const round1PromptA = providerA.requests[1]!.messages.map((message) => message.content).join("\n");
      expect(round1PromptA).not.toContain("Consider the budget constraint.");

      expect(events.some((event) => event.type === "injected" && event.message === "Consider the budget constraint.")).toBe(
        true,
      );
      expect(result.consensusReached).toBe(true);
    });

    it("stops asking further members and synthesizes from partial positions when forceVote() fires mid-round", async () => {
      const providerA = new StubProvider("A", ["Answer A0", "Forced synthesis noting only A answered"]);
      const providerB = new StubProvider("B", ["Answer B0 should never be requested"]);

      const events: CouncilEvent[] = [];
      const council = new Council({
        members: [
          { name: "A", provider: providerA },
          { name: "B", provider: providerB },
        ],
        onEvent: (event) => events.push(event),
      });

      const controller = new CouncilController();
      const originalChat = providerA.chat.bind(providerA);
      providerA.chat = async (request) => {
        const response = await originalChat(request);
        controller.forceVote();
        return response;
      };

      const result = await council.run("Should we do X?", controller);

      expect(result.forcedVote).toBe(true);
      expect(result.consensusReached).toBe(false);
      expect(result.rounds).toEqual([[{ member: "A", label: "A", content: "Answer A0" }]]);
      expect(providerB.requests).toHaveLength(0);
      expect(events.some((event) => event.type === "force-vote")).toBe(true);
      expect(result.answer).toBe("Forced synthesis noting only A answered");
    });
  });

  it("halts the debate once accumulated cost meets the budget cap, and still synthesizes", async () => {
    const providerA = new StubProvider("A", [
      "Answer A0",
      "DISSENT: not convinced\nStill dissenting round 1",
      "Best-effort synthesis under budget",
    ]);
    const providerB = new StubProvider("B", ["Answer B0", "DISSENT: prefer Y\nStill dissenting round 1"]);

    const events: CouncilEvent[] = [];
    // Each round produces 2 positions; a flat $1-per-position estimator crosses a $3 cap partway
    // through round 1 (round 0: $2 total, round 1: $4 total >= $3), well short of the 5-round cap.
    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      maxRounds: 5,
      budgetCap: 3,
      estimateCost: () => 1,
      onEvent: (event) => events.push(event),
    });

    const result = await council.run("Should we do X?");

    expect(result.budgetExceeded).toBe(true);
    expect(result.consensusReached).toBe(false);
    expect(result.finalRound).toBe(1);
    expect(result.rounds).toHaveLength(2);
    expect(result.answer).toBe("Best-effort synthesis under budget");

    const budgetEvent = events.find((event) => event.type === "budget-exceeded");
    expect(budgetEvent).toMatchObject({ type: "budget-exceeded", round: 1, spent: 4, cap: 3 });
    expect(events.some((event) => event.type === "moderator-synthesis")).toBe(true);
  });

  it("ignores budgetCap when no estimateCost callback is supplied", async () => {
    const providerA = new StubProvider("A", [
      "Answer A0",
      "DISSENT: not convinced\nStill dissenting",
      "Best-effort synthesis",
    ]);
    const providerB = new StubProvider("B", ["Answer B0", "DISSENT: prefer Y\nStill dissenting"]);

    const council = new Council({
      members: [
        { name: "A", provider: providerA },
        { name: "B", provider: providerB },
      ],
      maxRounds: 2,
      budgetCap: 0,
    });

    const result = await council.run("Should we do X?");

    expect(result.budgetExceeded).toBe(false);
    expect(result.finalRound).toBe(1);
    expect(result.rounds).toHaveLength(2);
  });
});
