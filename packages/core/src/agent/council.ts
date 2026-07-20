import type { ChatMessage, ChatProvider } from "../providers/types.js";

/** One seat on the council. Each member is wired to its own provider, unlike `AgentOrchestrator`
 * where every (sub-)agent shares one provider. */
export interface CouncilMember {
  name: string;
  provider: ChatProvider;
  systemPrompt?: string;
  /** Short label surfaced in prompts/events, e.g. "skeptic" or "domain expert". Purely descriptive. */
  role?: string;
}

export type MemberStance = "concur" | "dissent";

/** One member's contribution in one round. `stance`/`reason` are only set from round 1 onward —
 * round 0 is each member's independent first answer, before there's anything to concur or dissent from. */
export interface MemberPosition {
  member: string;
  content: string;
  stance?: MemberStance;
  reason?: string;
  /** Mirrors `CouncilMember.role`, if the member was configured with one. */
  role?: string;
}

export interface DroppedMember {
  member: string;
  /** Round in which the member's provider errored and it was dropped from the rest of the debate. */
  round: number;
  error: string;
}

export interface CouncilOptions {
  members: CouncilMember[];
  /** Optional distinct, non-debating moderator that only synthesizes the final answer and never
   * argues a position. Defaults to `members[0]` when omitted, preserving the original behavior
   * where the first member both debates and synthesizes. */
  moderator?: CouncilMember;
  /** Hard cap on debate rounds (round 0 counts as the first). Default 4. */
  maxRounds?: number;
  onEvent?: (event: CouncilEvent) => void;
}

export type CouncilEvent =
  | { type: "round-start"; round: number }
  | { type: "member-position"; round: number; position: MemberPosition }
  | { type: "member-dropped"; round: number; member: string; error: string }
  | { type: "consensus"; round: number }
  | { type: "moderator-synthesis"; content: string }
  | { type: "moderator-error"; error: string };

export interface CouncilResult {
  question: string;
  /** Every round's positions, in order. `rounds[0]` is the independent-answer round. */
  rounds: MemberPosition[][];
  consensusReached: boolean;
  /** Index of the last round that actually ran (may be < maxRounds - 1 if consensus was reached early). */
  finalRound: number;
  dropped: DroppedMember[];
  /** The moderator's synthesized final answer, or a deterministic fallback summary if the moderator's
   * provider errored (see `moderatorError`) — the completed debate is never discarded on a moderator failure. */
  answer: string;
  /** Set if the moderator's provider errored while synthesizing; `answer` is then a fallback summary. */
  moderatorError?: string;
}

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;
const DEFAULT_MAX_ROUNDS = 4;

const CONCUR_PATTERN = /^\s*CONCUR\b:?\s*/i;
const DISSENT_PATTERN = /^\s*DISSENT\s*:\s*([^\n]*)\n?([\s\S]*)$/i;

/** Asks the moderator for a Decision Brief shape the client can parse into distinct sections
 * (see `parseDecisionBrief` in the browser app's council reducer) while staying plain text — no
 * markdown/JSON contract is enforced, so callers must treat parsing as best-effort. */
const DECISION_BRIEF_FORMAT =
  'Write the Decision Brief using exactly these section headers, each alone on its own line: "Recommendation:", ' +
  '"Rationale:", "Key contention & resolution:", "Next steps:". Keep each section concise.';

/**
 * Multi-provider debate: each member answers independently, then revises across rounds after
 * seeing every other member's latest position, until all concur or a hard round cap is hit. A
 * moderator (the first member's provider) then synthesizes the final answer.
 */
export class Council {
  private readonly members: CouncilMember[];
  private readonly moderator: CouncilMember;
  private readonly maxRounds: number;
  private readonly onEvent?: (event: CouncilEvent) => void;

  constructor(options: CouncilOptions) {
    if (options.members.length < MIN_MEMBERS || options.members.length > MAX_MEMBERS) {
      throw new Error(
        `Council requires between ${MIN_MEMBERS} and ${MAX_MEMBERS} members, got ${options.members.length}`,
      );
    }
    this.members = options.members;
    this.moderator = options.moderator ?? this.members[0]!;
    this.maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    this.onEvent = options.onEvent;
  }

  async run(question: string): Promise<CouncilResult> {
    const rounds: MemberPosition[][] = [];
    const dropped: DroppedMember[] = [];
    let active = this.members;
    let consensusReached = false;
    let finalRound = 0;

    for (let round = 0; round < this.maxRounds && active.length > 0; round++) {
      this.onEvent?.({ type: "round-start", round });

      const positions: MemberPosition[] = [];
      const survivors: CouncilMember[] = [];
      const previousPositions = rounds.at(-1);

      for (const member of active) {
        try {
          const position =
            round === 0
              ? await this.askInitial(member, question)
              : await this.askRevision(member, question, previousPositions ?? []);
          positions.push(position);
          survivors.push(member);
          this.onEvent?.({ type: "member-position", round, position });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          dropped.push({ member: member.name, round, error: message });
          this.onEvent?.({ type: "member-dropped", round, member: member.name, error: message });
        }
      }

      rounds.push(positions);
      active = survivors;
      finalRound = round;

      if (round > 0 && positions.length > 0 && positions.every((position) => position.stance === "concur")) {
        consensusReached = true;
        this.onEvent?.({ type: "consensus", round });
        break;
      }
    }

    let answer: string;
    let moderatorError: string | undefined;
    try {
      answer = await this.synthesize(question, rounds, dropped, consensusReached);
      this.onEvent?.({ type: "moderator-synthesis", content: answer });
    } catch (error) {
      moderatorError = error instanceof Error ? error.message : String(error);
      answer = this.fallbackSynthesis(rounds, dropped, consensusReached);
      this.onEvent?.({ type: "moderator-error", error: moderatorError });
    }

    return { question, rounds, consensusReached, finalRound, dropped, answer, moderatorError };
  }

  private async askInitial(member: CouncilMember, question: string): Promise<MemberPosition> {
    const response = await member.provider.chat({ messages: this.buildMessages(member, question) });
    return { member: member.name, role: member.role, content: response.message.content };
  }

  private async askRevision(
    member: CouncilMember,
    question: string,
    previousPositions: MemberPosition[],
  ): Promise<MemberPosition> {
    const labeled = previousPositions
      .map((position) => `${position.member}${position.role ? ` (${position.role})` : ""}: ${position.content}`)
      .join("\n\n");
    const prompt = [
      `Question: ${question}`,
      "",
      "Positions from the previous round:",
      labeled,
      "",
      "Revise your position if warranted based on the other members' reasoning. " +
        "If you agree with the emerging consensus, start your reply with \"CONCUR\" followed by your " +
        "(possibly unchanged) position. If you still disagree, start your reply with " +
        "\"DISSENT: <one-line reason>\" on the first line, then your position.",
    ].join("\n");

    const response = await member.provider.chat({ messages: this.buildMessages(member, prompt) });
    return this.parseStance(member, response.message.content);
  }

  private buildMessages(member: CouncilMember, content: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const systemParts = [member.systemPrompt, member.role ? `Your role on this council: ${member.role}.` : undefined].filter(
      (part): part is string => Boolean(part),
    );
    if (systemParts.length > 0) messages.push({ role: "system", content: systemParts.join("\n\n") });
    messages.push({ role: "user", content });
    return messages;
  }

  private parseStance(member: CouncilMember, content: string): MemberPosition {
    const concurMatch = CONCUR_PATTERN.exec(content);
    if (concurMatch) {
      const rest = content.slice(concurMatch[0].length).trim();
      return { member: member.name, role: member.role, content: rest || content.trim(), stance: "concur" };
    }

    const dissentMatch = DISSENT_PATTERN.exec(content);
    if (dissentMatch) {
      const reason = dissentMatch[1]?.trim();
      const rest = dissentMatch[2]?.trim();
      return {
        member: member.name,
        role: member.role,
        content: rest || content.trim(),
        stance: "dissent",
        reason: reason || undefined,
      };
    }

    // No explicit CONCUR/DISSENT marker: treat as a (silent) dissent so an ambiguous reply can never
    // be mistaken for unanimous concurrence and end the debate early.
    return {
      member: member.name,
      role: member.role,
      content: content.trim(),
      stance: "dissent",
      reason: "no explicit stance given",
    };
  }

  private async synthesize(
    question: string,
    rounds: MemberPosition[][],
    dropped: DroppedMember[],
    consensusReached: boolean,
  ): Promise<string> {
    const moderator = this.moderator;
    const finalPositions = rounds.at(-1) ?? [];
    const dissenting = finalPositions.filter((position) => position.stance === "dissent");

    const transcript = rounds
      .map((positions, round) => {
        const lines = positions.map((position) => {
          const role = position.role ? ` (${position.role})` : "";
          const stance = position.stance ? ` [${position.stance}${position.reason ? `: ${position.reason}` : ""}]` : "";
          return `- ${position.member}${role}${stance}: ${position.content}`;
        });
        return `Round ${round}:\n${lines.join("\n")}`;
      })
      .join("\n\n");

    const droppedNote = dropped.length
      ? `\nMembers dropped from the debate after a provider error: ${dropped
          .map((member) => `${member.member} (round ${member.round}: ${member.error})`)
          .join(", ")}.`
      : "";

    const outcomeNote = consensusReached
      ? "The council reached unanimous consensus. Write the final answer."
      : `The council did not reach unanimous consensus within ${rounds.length} round(s). Write the best final ` +
        "answer, explicitly noting the unresolved dissent below.";

    const dissentNote = dissenting.length
      ? `\nUnresolved dissent:\n${dissenting
          .map((position) => `- ${position.member}: ${position.reason ?? "no reason given"}`)
          .join("\n")}`
      : "";

    const prompt = [
      "You are the moderator synthesizing a council debate on the following question:",
      question,
      "",
      "Debate transcript:",
      transcript,
      droppedNote,
      "",
      outcomeNote,
      dissentNote,
      "",
      DECISION_BRIEF_FORMAT,
    ]
      .filter((line) => line !== "")
      .join("\n");

    const response = await moderator.provider.chat({ messages: this.buildMessages(moderator, prompt) });
    return response.message.content;
  }

  /**
   * Deterministic, non-LLM fallback used when the moderator's own provider call fails. The debate
   * itself already completed by this point, so a moderator error must never discard it — this just
   * can't add the moderator's prose synthesis on top.
   */
  private fallbackSynthesis(
    rounds: MemberPosition[][],
    dropped: DroppedMember[],
    consensusReached: boolean,
  ): string {
    const finalPositions = rounds.at(-1) ?? [];
    const dissenting = finalPositions.filter((position) => position.stance === "dissent");

    const consensusNote = consensusReached
      ? "The council reached unanimous consensus, but the moderator's provider errored while synthesizing a final answer."
      : `The council did not reach unanimous consensus within ${rounds.length} round(s), and the moderator's ` +
        "provider errored while synthesizing a final answer.";

    const droppedNote = dropped.length
      ? ` Members dropped from the debate after a provider error: ${dropped
          .map((member) => `${member.member} (round ${member.round})`)
          .join(", ")}.`
      : "";

    const dissentNote = dissenting.length
      ? `\nUnresolved dissent:\n${dissenting
          .map((position) => `- ${position.member}: ${position.reason ?? "no reason given"}`)
          .join("\n")}`
      : "";

    const positionLines = finalPositions
      .map((position) => `- ${position.member}${position.role ? ` (${position.role})` : ""}: ${position.content}`)
      .join("\n");

    return [`${consensusNote}${droppedNote}`, dissentNote, "", "Final positions:", positionLines]
      .filter((line) => line !== "")
      .join("\n");
  }
}
