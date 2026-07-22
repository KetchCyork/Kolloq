import { describe, expect, it } from "vitest";
import type { CouncilSession } from "./types";
import { councilIdentity, randomIdentity, renameLegacyCouncilIdentities } from "./utils";

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
