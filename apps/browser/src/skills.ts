import type { Skill } from "./types";

/**
 * Skills are SKILL.md-style instruction packages (spec §4/§7): installed globally in Settings,
 * attached per-agent, and folded into the attached agent's system prompt at turn time. Everything in
 * this module is pure so the parsing and prompt-composition rules are unit-testable without a DOM.
 */

export interface ParsedSkillFile {
  name: string;
  description: string;
  instructions: string;
}

/** Strips one layer of matching quotes from a frontmatter scalar. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith('"') || trimmed.startsWith("'")) && trimmed.endsWith(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** `board-memo-format.md` -> `board memo format`. Used when a file has no name to go on. A file
 * literally named `SKILL.md` is the convention, not a name, so it yields nothing to fall back to. */
function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
  return base.toLowerCase() === "skill" ? "" : base;
}

/**
 * Parses a SKILL.md-style file: optional `---` YAML frontmatter with `name`/`description`, then a
 * markdown body that becomes the skill's instructions. Only the two scalar keys we use are read —
 * this is deliberately not a general YAML parser. Falls back to the body's first H1 and then the
 * file name for `name`, so a plain markdown file with no frontmatter still imports usefully.
 */
export function parseSkillFile(text: string, fileName?: string): ParsedSkillFile {
  const normalized = text.replace(/\r\n/g, "\n");
  const front: Record<string, string> = {};
  let body = normalized;

  const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/.exec(normalized);
  if (match) {
    for (const line of match[1].split("\n")) {
      const pair = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(line);
      if (pair) front[pair[1].toLowerCase()] = unquote(pair[2]);
    }
    body = normalized.slice(match[0].length);
  }

  const heading = /^#[ \t]+(.+)$/m.exec(body);
  const name = front.name?.trim() || heading?.[1].trim() || (fileName ? nameFromFileName(fileName) : "");

  return {
    name,
    description: front.description?.trim() ?? "",
    instructions: body.trim(),
  };
}

/** Skills attached to one agent, in install order. Disabled skills are kept (Settings still lists them). */
export function skillsForAgent(skills: Skill[], agentId: string): Skill[] {
  return skills.filter((skill) => skill.attachedAgentIds.includes(agentId));
}

/** Count shown on the agent card — attached *and* enabled, i.e. what the agent will actually use. */
export function activeSkillCountForAgent(skills: Skill[], agentId: string): number {
  return skillsForAgent(skills, agentId).filter((skill) => skill.enabled && skill.instructions.trim()).length;
}

/**
 * Folds an agent's attached skills into its system prompt. Disabled and empty skills are skipped, so
 * toggling a skill off in Settings takes effect on the next turn without detaching it. Returns the
 * base prompt unchanged when nothing is active, keeping prompts identical to pre-skills behavior.
 */
export function composeAgentSystemPrompt(basePrompt: string, skills: Skill[]): string {
  const active = skills.filter((skill) => skill.enabled && skill.instructions.trim());
  if (active.length === 0) return basePrompt;

  const blocks = active.map((skill) => {
    const header = `## Skill: ${skill.name || "Untitled skill"}`;
    const description = skill.description.trim();
    return [header, description, skill.instructions.trim()].filter(Boolean).join("\n\n");
  });

  return [
    basePrompt.trim(),
    "# Skills",
    "The following skills are attached to you. Apply a skill whenever the task matches what it describes.",
    ...blocks,
  ]
    .filter(Boolean)
    .join("\n\n");
}
