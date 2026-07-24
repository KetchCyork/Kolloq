import { describe, expect, it } from "vitest";
import { activeSkillCountForAgent, composeAgentSystemPrompt, parseSkillFile, skillsForAgent } from "./skills";
import type { Skill } from "./types";

function skill(patch: Partial<Skill> = {}): Skill {
  return {
    id: "s1",
    name: "Board memo format",
    description: "Formats a memo for the board.",
    instructions: "Open with a one-line recommendation.",
    source: "pasted",
    enabled: true,
    attachedAgentIds: [],
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe("parseSkillFile", () => {
  it("reads name and description from frontmatter and keeps the body as instructions", () => {
    const parsed = parseSkillFile(
      ["---", 'name: "Brand voice"', "description: How we sound in public.", "---", "", "# Brand voice", "", "Be plain."].join(
        "\n",
      ),
      "brand-voice.md",
    );
    expect(parsed.name).toBe("Brand voice");
    expect(parsed.description).toBe("How we sound in public.");
    expect(parsed.instructions).toBe("# Brand voice\n\nBe plain.");
  });

  it("falls back to the body H1, then the file name, when frontmatter has no name", () => {
    expect(parseSkillFile("# Weekly review\n\nSteps:").name).toBe("Weekly review");
    expect(parseSkillFile("Just instructions.", "board-memo-format.md").name).toBe("board memo format");
    expect(parseSkillFile("Just instructions.", "SKILL.md").name).toBe("");
  });

  it("handles CRLF files and ignores frontmatter keys it doesn't use", () => {
    const parsed = parseSkillFile("---\r\nname: Tone\r\nlicense: MIT\r\n---\r\n\r\nBody line.\r\n");
    expect(parsed.name).toBe("Tone");
    expect(parsed.description).toBe("");
    expect(parsed.instructions).toBe("Body line.");
  });

  it("treats a lone --- line as content, not frontmatter", () => {
    const parsed = parseSkillFile("--- \nnot frontmatter");
    expect(parsed.instructions).toBe("--- \nnot frontmatter");
  });
});

describe("skillsForAgent", () => {
  const skills = [
    skill({ id: "a", attachedAgentIds: ["agent-1"] }),
    skill({ id: "b", attachedAgentIds: ["agent-2"] }),
    skill({ id: "c", attachedAgentIds: ["agent-1", "agent-2"], enabled: false }),
  ];

  it("returns attached skills including disabled ones", () => {
    expect(skillsForAgent(skills, "agent-1").map((s) => s.id)).toEqual(["a", "c"]);
    expect(skillsForAgent(skills, "agent-3")).toEqual([]);
  });

  it("counts only enabled, non-empty skills as active", () => {
    expect(activeSkillCountForAgent(skills, "agent-1")).toBe(1);
    expect(activeSkillCountForAgent([...skills, skill({ id: "d", instructions: "  ", attachedAgentIds: ["agent-1"] })], "agent-1")).toBe(1);
  });
});

describe("composeAgentSystemPrompt", () => {
  it("returns the base prompt untouched when no skill is active", () => {
    expect(composeAgentSystemPrompt("You are helpful.", [])).toBe("You are helpful.");
    expect(composeAgentSystemPrompt("You are helpful.", [skill({ enabled: false })])).toBe("You are helpful.");
    expect(composeAgentSystemPrompt("You are helpful.", [skill({ instructions: "   " })])).toBe("You are helpful.");
  });

  it("appends a Skills section with one block per active skill", () => {
    const composed = composeAgentSystemPrompt("You are helpful.", [
      skill({ id: "a", name: "Brand voice", description: "How we sound.", instructions: "Be plain." }),
      skill({ id: "b", name: "Board memo", description: "", instructions: "Lead with the ask." }),
    ]);
    expect(composed).toBe(
      [
        "You are helpful.",
        "",
        "# Skills",
        "",
        "The following skills are attached to you. Apply a skill whenever the task matches what it describes.",
        "",
        "## Skill: Brand voice",
        "",
        "How we sound.",
        "",
        "Be plain.",
        "",
        "## Skill: Board memo",
        "",
        "Lead with the ask.",
      ].join("\n"),
    );
  });

  it("still emits a skill block when the agent has no base prompt", () => {
    const composed = composeAgentSystemPrompt("", [skill({ name: "", instructions: "Do the thing." })]);
    expect(composed.startsWith("# Skills")).toBe(true);
    expect(composed).toContain("## Skill: Untitled skill");
  });
});
