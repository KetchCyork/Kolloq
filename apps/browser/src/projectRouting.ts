import type { ProjectMemberConfig, ProjectTaskStatus } from "./types";

/** Special composer picker value meaning "resolve automatically" rather than a specific roster member id. */
export const AUTO_ROUTE = "auto";

/** Finds the first `@name` mention in `text` that matches a roster member's identity name
 * (case-insensitive, first word only — roster names are single words like "Atlas" or "Critic"). */
export function resolveMentionedMember(
  text: string,
  roster: ProjectMemberConfig[],
): ProjectMemberConfig | undefined {
  const match = text.match(/@([A-Za-z0-9_-]+)/);
  if (!match) return undefined;
  const mention = match[1].toLowerCase();
  return roster.find((member) => member.identity.name.toLowerCase() === mention);
}

/**
 * Resolves which roster member should answer a project chat message. An explicit picker
 * selection wins; otherwise falls back to an `@mention` in the text, then to the first roster
 * member (spec doesn't define "auto" beyond "an auto-route agent picker" — this is the simplest
 * deterministic reading: direct if mentioned, else the project's primary agent).
 */
export function resolveRoutedMember(
  text: string,
  roster: ProjectMemberConfig[],
  pickedMemberId: string,
): ProjectMemberConfig | undefined {
  if (pickedMemberId !== AUTO_ROUTE) {
    return roster.find((member) => member.id === pickedMemberId);
  }
  return resolveMentionedMember(text, roster) ?? roster[0];
}

const STATUS_CYCLE: ProjectTaskStatus[] = ["todo", "in_progress", "done"];

export function cycleTaskStatus(status: ProjectTaskStatus): ProjectTaskStatus {
  const index = STATUS_CYCLE.indexOf(status);
  return STATUS_CYCLE[(index + 1) % STATUS_CYCLE.length];
}

export function taskStatusLabel(status: ProjectTaskStatus): string {
  switch (status) {
    case "done":
      return "done";
    case "in_progress":
      return "in progress";
    case "todo":
    default:
      return "to do";
  }
}
