import { describe, expect, it } from "vitest";
import type { ChatProvider, ChatRequest, ChatResponse, StreamEvent } from "../providers/types.js";
import { Council, type CouncilEvent } from "./council.js";

/** Deterministic fixed-playback provider — one instance per council member, no live/paid API calls. */
class StubProvider implements ChatProvider {
  readonly model = "stub-model";
  private step = 0;

  constructor(
    readonly id: string,
    private readonly responses: string[],
  ) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
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
      { member: "A", content: "Answer A0" },
      { member: "B", content: "Answer B0" },
    ]);
    expect(result.rounds[1]).toEqual([
      { member: "A", content: "I agree with B", stance: "concur" },
      { member: "B", content: "sounds good", stance: "concur" },
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
      { member: "A", content: "Still think X is risky", stance: "dissent", reason: "not convinced" },
      { member: "B", content: "Y is safer", stance: "dissent", reason: "prefer Y" },
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

    expect(result.dropped).toEqual([{ member: "A", round: 1, error: "A provider error" }]);
    // Round 1 has only B (A dropped); round 2 is B alone concurring, which is a unanimous (of one) consensus.
    expect(result.rounds).toHaveLength(3);
    expect(result.rounds[1]).toEqual([
      { member: "B", content: "B's dissenting position", stance: "dissent", reason: "still unsure" },
    ]);
    expect(result.consensusReached).toBe(true);
    expect(result.finalRound).toBe(2);
    // Moderator is still the first member (A)'s provider, even though A dropped out of the debate itself.
    expect(result.answer).toBe("A synthesis final answer");

    expect(events.some((event) => event.type === "member-dropped" && event.member === "A" && event.round === 1)).toBe(
      true,
    );
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
      content: "I'm not sure, maybe both are fine",
      stance: "dissent",
      reason: "no explicit stance given",
    });
  });
});
