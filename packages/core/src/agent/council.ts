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
}

export interface DroppedMember {
  member: string;
  /** Round in which the member's provider errored and it was dropped from the rest of the debate. */
  round: number;
  error: string;
}

export interface CouncilOptions {
  members: CouncilMember[];
  /** Hard cap on debate rounds (round 0 counts as the first). Default 4. */
  maxRounds?: number;
  onEvent?: (event: CouncilEvent) => void;
}

export type CouncilEvent =
  | { type: "round-start"; round: number }
  | { type: "member-position"; round: number; position: MemberPosition }
  | { type: "member-dropped"; round: number; member: string; error: string }
  | { type: "consensus"; round: number }
  | { type: "moderator-synthesis"; content: string };

export interface CouncilResult {
  question: string;
  /** Every round's positions, in order. `rounds[0]` is the independent-answer round. */
  rounds: MemberPosition[][];
  consensusReached: boolean;
  /** Index of the last round that actually ran (may be < maxRounds - 1 if consensus was reached early). */
  finalRound: number;
  dropped: DroppedMember[];
  /** The moderator's synthesized final answer. */
  answer: string;
}

const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;
const DEFAULT_MAX_ROUNDS = 4;

const CONCUR_PATTERN = /^\s*CONCUR\b:?\s*/i;
const DISSENT_PATTERN = /^\s*DISSENT\s*:\s*([^\n]*)\n?([\s\S]*)$/i;

/**
 * Multi-provider debate: each member answers independently, then revises across rounds after
 * seeing every other member's latest position, until all concur or a hard round cap is hit. A
 * moderator (the first member's provider) then synthesizes the final answer.
 */
export class Council {
  private readonly members: CouncilMember[];
  private readonly maxRounds: number;
  private readonly onEvent?: (event: CouncilEvent) => void;

  constructor(options: CouncilOptions) {
    if (options.members.length < MIN_MEMBERS || options.members.length > MAX_MEMBERS) {
      throw new Error(
        `Council requires between ${MIN_MEMBERS} and ${MAX_MEMBERS} members, got ${options.members.length}`,
      );
    }
    this.members = options.members;
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

    const answer = await this.synthesize(question, rounds, dropped, consensusReached);
    this.onEvent?.({ type: "moderator-synthesis", content: answer });

    return { question, rounds, consensusReached, finalRound, dropped, answer };
  }

  private async askInitial(member: CouncilMember, question: string): Promise<MemberPosition> {
    const response = await member.provider.chat({ messages: this.buildMessages(member, question) });
    return { member: member.name, content: response.message.content };
  }

  private async askRevision(
    member: CouncilMember,
    question: string,
    previousPositions: MemberPosition[],
  ): Promise<MemberPosition> {
    const labeled = previousPositions
      .map((position) => `${position.member}: ${position.content}`)
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
    return this.parseStance(member.name, response.message.content);
  }

  private buildMessages(member: CouncilMember, content: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (member.systemPrompt) messages.push({ role: "system", content: member.systemPrompt });
    messages.push({ role: "user", content });
    return messages;
  }

  private parseStance(member: string, content: string): MemberPosition {
    const concurMatch = CONCUR_PATTERN.exec(content);
    if (concurMatch) {
      const rest = content.slice(concurMatch[0].length).trim();
      return { member, content: rest || content.trim(), stance: "concur" };
    }

    const dissentMatch = DISSENT_PATTERN.exec(content);
    if (dissentMatch) {
      const reason = dissentMatch[1]?.trim();
      const rest = dissentMatch[2]?.trim();
      return { member, content: rest || content.trim(), stance: "dissent", reason: reason || undefined };
    }

    // No explicit CONCUR/DISSENT marker: treat as a (silent) dissent so an ambiguous reply can never
    // be mistaken for unanimous concurrence and end the debate early.
    return { member, content: content.trim(), stance: "dissent", reason: "no explicit stance given" };
  }

  private async synthesize(
    question: string,
    rounds: MemberPosition[][],
    dropped: DroppedMember[],
    consensusReached: boolean,
  ): Promise<string> {
    const moderator = this.members[0]!;
    const finalPositions = rounds.at(-1) ?? [];
    const dissenting = finalPositions.filter((position) => position.stance === "dissent");

    const transcript = rounds
      .map((positions, round) => {
        const lines = positions.map((position) => {
          const stance = position.stance ? ` (${position.stance}${position.reason ? `: ${position.reason}` : ""})` : "";
          return `- ${position.member}${stance}: ${position.content}`;
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
    ]
      .filter((line) => line !== "")
      .join("\n");

    const response = await moderator.provider.chat({ messages: this.buildMessages(moderator, prompt) });
    return response.message.content;
  }
}
