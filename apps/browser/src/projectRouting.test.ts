import { describe, expect, it } from "vitest";
import { AUTO_ROUTE, cycleTaskStatus, resolveMentionedMember, resolveRoutedMember } from "./projectRouting";
import type { ProjectMemberConfig } from "./types";

function member(id: string, name: string): ProjectMemberConfig {
  return { id, accountId: `acct-${id}`, identity: { name, color: "#000", emoji: "🤖" } };
}

const roster = [member("m1", "Atlas"), member("m2", "Critic"), member("m3", "Forge")];

describe("resolveMentionedMember", () => {
  it("matches a case-insensitive @mention against roster names", () => {
    expect(resolveMentionedMember("@atlas rewrite the page", roster)?.id).toBe("m1");
    expect(resolveMentionedMember("Forge, once that's in @Forge please ship", roster)?.id).toBe("m3");
  });

  it("returns undefined when there's no mention or no match", () => {
    expect(resolveMentionedMember("just a plain message", roster)).toBeUndefined();
    expect(resolveMentionedMember("@nobody here", roster)).toBeUndefined();
  });

  it("does not treat an email address's domain as a mention", () => {
    const nova = [...roster, member("m4", "Nova")];
    expect(resolveMentionedMember("please email support@Nova.io about this", nova)).toBeUndefined();
    expect(resolveMentionedMember("cc atlas@Forge.io and @Atlas too", roster)?.id).toBe("m1");
  });
});

describe("resolveRoutedMember", () => {
  it("honors an explicit picker selection over any mention", () => {
    expect(resolveRoutedMember("@atlas do it", roster, "m2")?.id).toBe("m2");
  });

  it("falls back to the mentioned member when the picker is Auto", () => {
    expect(resolveRoutedMember("@critic review this", roster, AUTO_ROUTE)?.id).toBe("m2");
  });

  it("falls back to the first roster member when Auto and no mention", () => {
    expect(resolveRoutedMember("no mention here", roster, AUTO_ROUTE)?.id).toBe("m1");
  });

  it("returns undefined for an empty roster", () => {
    expect(resolveRoutedMember("hello", [], AUTO_ROUTE)).toBeUndefined();
  });
});

describe("cycleTaskStatus", () => {
  it("cycles todo -> in_progress -> done -> todo", () => {
    expect(cycleTaskStatus("todo")).toBe("in_progress");
    expect(cycleTaskStatus("in_progress")).toBe("done");
    expect(cycleTaskStatus("done")).toBe("todo");
  });
});
