import { describe, expect, it } from "vitest";
import type { CouncilMemberConfig, CouncilSession, CouncilTurn } from "./types";
import {
  councilIdentity,
  councilListSubtitle,
  councilListTitle,
  randomIdentity,
  renameLegacyCouncilIdentities,
  shortCouncilTitle,
  titleUntitledCouncils,
} from "./utils";

function council(id: string, name: string, createdAt: number): CouncilSession {
  return {
    id,
    identity: { name, color: "#000000", emoji: "\u{1F3DB}\u{FE0F}" },
    members: [],
    turns: [],
    createdAt,
    updatedAt: createdAt,
  };
}

function turn(question: string, consensusReached = true): CouncilTurn {
  return {
    id: `turn-${question}`,
    question,
    createdAt: 0,
    rounds: [],
    consensusReached,
    finalRound: 0,
    maxRounds: 4,
    dropped: [],
    answer: "",
    totalCostNote: "",
  };
}

function seats(count: number): CouncilMemberConfig[] {
  return Array.from({ length: count }, (_, index) => ({ id: `m${index}`, accountId: `a${index}` }));
}

describe("councilIdentity", () => {
  it("names councils Council N, numbered independently of agents", () => {
    expect(councilIdentity(0).name).toBe("Council 1");
    expect(councilIdentity(1).name).toBe("Council 2");
    expect(randomIdentity(0).name).toBe("Agent 1");
  });

  it("always uses the council emoji", () => {
    expect(councilIdentity(0).emoji).toBe("\u{1F3DB}\u{FE0F}");
    expect(councilIdentity(9).emoji).toBe("\u{1F3DB}\u{FE0F}");
  });
});

describe("renameLegacyCouncilIdentities", () => {
  it("renumbers councils stored as 'Agent N' by creation order", () => {
    const result = renameLegacyCouncilIdentities([
      council("b", "Agent 3", 200),
      council("a", "Agent 1", 100),
    ]);
    expect(result.sessions.map((s) => [s.id, s.identity.name])).toEqual([
      ["b", "Council 2"],
      ["a", "Council 1"],
    ]);
    expect(result.changedIds).toEqual(new Set(["a", "b"]));
  });

  it("leaves user-renamed and already-correct councils untouched", () => {
    const sessions = [council("a", "Council 1", 100), council("b", "Design review", 200)];
    const result = renameLegacyCouncilIdentities(sessions);
    expect(result.sessions).toEqual(sessions);
    expect(result.changedIds.size).toBe(0);
  });
});

describe("shortCouncilTitle", () => {
  it("keeps a short question intact and drops its trailing punctuation", () => {
    expect(shortCouncilTitle("Build vs. buy billing?")).toBe("Build vs. buy billing");
  });

  it("collapses whitespace", () => {
    expect(shortCouncilTitle("Build   vs.\n buy  billing")).toBe("Build vs. buy billing");
  });

  it("truncates a long question on a word boundary, with no ellipsis to leak into the rename field", () => {
    const title = shortCouncilTitle("Should we build our own billing stack or buy one off the shelf?");
    expect(title).toBe("Should we build our own billing");
    expect(title.length).toBeLessThanOrEqual(34);
  });

  it("cuts mid-word only when the first word overruns the budget", () => {
    expect(shortCouncilTitle("Supercalifragilisticexpialidociousness rating", 20)).toBe("Supercalifragilistic");
  });
});

describe("titleUntitledCouncils", () => {
  it("titles a placeholder-named council from its first question", () => {
    const session = { ...council("a", "Council 1", 100), turns: [turn("Build vs. buy billing?"), turn("Later ask")] };
    const result = titleUntitledCouncils([session]);
    expect(result.sessions[0].identity.name).toBe("Build vs. buy billing");
    expect(result.changedIds).toEqual(new Set(["a"]));
  });

  it("leaves renamed councils and councils with no turns alone", () => {
    const sessions = [
      { ...council("a", "Design review", 100), turns: [turn("Build vs. buy billing?")] },
      council("b", "Council 2", 200),
    ];
    const result = titleUntitledCouncils(sessions);
    expect(result.sessions).toEqual(sessions);
    expect(result.changedIds.size).toBe(0);
  });
});

describe("councilListTitle", () => {
  it("prefixes a titled council so it still reads as a council", () => {
    expect(councilListTitle({ ...council("a", "Build vs. buy billing", 0) })).toBe("Council: Build vs. buy billing");
  });

  it("does not double up on names that already start with Council", () => {
    expect(councilListTitle(council("a", "Council 1", 0))).toBe("Council 1");
    expect(councilListTitle(council("a", "Council of elders", 0))).toBe("Council of elders");
  });

  it("falls back to a bare label when the user clears the name", () => {
    expect(councilListTitle(council("a", "   ", 0))).toBe("Council");
  });
});

describe("councilListSubtitle", () => {
  it("reports seat count and the outcome of the last turn", () => {
    const session = { ...council("a", "Council 1", 0), members: seats(5), turns: [turn("q", true)] };
    expect(councilListSubtitle(session, false)).toBe("5 agents · Consensus");
  });

  it("says so when the council failed to converge", () => {
    const session = { ...council("a", "Council 1", 0), members: seats(2), turns: [turn("q", true), turn("q2", false)] };
    expect(councilListSubtitle(session, false)).toBe("2 agents · No consensus");
  });

  it("shows a live debate and an unused council distinctly, and singularizes one seat", () => {
    const idle = { ...council("a", "Council 1", 0), members: seats(1) };
    expect(councilListSubtitle(idle, false)).toBe("1 agent · Not started");
    expect(councilListSubtitle(idle, true)).toBe("1 agent · Debating…");
  });
});
