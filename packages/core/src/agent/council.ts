import { classifyProviderError } from "../providers/errorReason.js";
import type { ChatMessage, ChatProvider } from "../providers/types.js";

/** One seat on the council. Each member is wired to its own provider, unlike `AgentOrchestrator`
 * where every (sub-)agent shares one provider. */
export interface CouncilMember {
  /** Opaque identifier used to correlate events/positions back to this member. Never shown to a
   * human or embedded in a prompt — callers that need a caller-side id (e.g. a database key) should
   * put it here and use `label` for anything display- or prompt-facing. */
  name: string;
  provider: ChatProvider;
  systemPrompt?: string;
  /** Short label surfaced in prompts/events, e.g. "skeptic" or "domain expert". Purely descriptive. */
  role?: string;
  /** Human-readable display name used anywhere debate text is composed for a human or an LLM
   * (transcripts, the moderator's synthesis prompt, fallback summaries). Falls back to `name` when
   * absent, so callers that don't need `name`/display to differ can omit this. */
  label?: string;
}

export type MemberStance = "concur" | "dissent";

/** One member's contribution in one round. `stance`/`reason` are only set from round 1 onward —
 * round 0 is each member's independent first answer, before there's anything to concur or dissent from. */
export interface MemberPosition {
  member: string;
  /** Mirrors `CouncilMember.label` (or `name` if no label was set) — use this, not `member`, in any
   * text shown to a human or fed back into a prompt. */
  label: string;
  content: string;
  stance?: MemberStance;
  reason?: string;
  /** Mirrors `CouncilMember.role`, if the member was configured with one. */
  role?: string;
}

export interface DroppedMember {
  member: string;
  /** Mirrors `CouncilMember.label` (or `name` if no label was set). */
  label: string;
  /** Round in which the member's provider errored and it was dropped from the rest of the debate. */
  round: number;
  error: string;
}

/** One member's judged agreement with the round's leading proposal, per the product spec's 0-10
 * convergence check (moderator identifies the leading proposal, scores each member's alignment
 * with it). Produced by an extra moderator LLM call per round — see `Council.scoreAlignment` —
 * not self-reported by the member, so it's independent of `MemberPosition.stance`. */
export interface AlignmentScore {
  member: string;
  /** Mirrors `CouncilMember.label` (or `name` if no label was set). */
  label: string;
  /** 0 (strongly disagrees with the leading proposal) to 10 (fully agrees). */
  score: number;
  /** The judge's one-line reason for the score, when it provided one. */
  justification?: string;
}

/** One round's alignment judging: every member the judge scored, plus their average. Only
 * produced for round > 0 (round 0 is independent answers — there's no leading proposal yet to
 * score agreement against) and only when the judge call succeeded and parsed at least one score. */
export interface RoundAlignment {
  round: number;
  scores: AlignmentScore[];
  average: number;
}

export interface CouncilOptions {
  members: CouncilMember[];
  /** Optional distinct, non-debating moderator that only synthesizes the final answer and never
   * argues a position. Defaults to `members[0]` when omitted, preserving the original behavior
   * where the first member both debates and synthesizes. */
  moderator?: CouncilMember;
  /** Hard cap on debate rounds (round 0 counts as the first). Default 4. */
  maxRounds?: number;
  /** Hard budget cap in USD. Once accumulated estimated spend (as reported by `estimateCost`) meets
   * or exceeds this after a round, the round loop halts and moves straight to synthesis, the same
   * way hitting `maxRounds` does. No-op unless `estimateCost` is also supplied — the engine has no
   * built-in notion of provider pricing, so a caller that wants enforcement must supply one. */
  budgetCap?: number;
  /** Estimates the USD cost of one member's response. Called once per position produced (each round,
   * each surviving member) and accumulated across the whole debate to enforce `budgetCap`. */
  estimateCost?: (member: CouncilMember, content: string) => number;
  onEvent?: (event: CouncilEvent) => void;
}

export type CouncilEvent =
  | { type: "round-start"; round: number }
  | { type: "member-position"; round: number; position: MemberPosition }
  | { type: "member-dropped"; round: number; member: string; label: string; error: string }
  | { type: "alignment-scores"; round: number; scores: AlignmentScore[]; average: number }
  | { type: "consensus"; round: number }
  | { type: "budget-exceeded"; round: number; spent: number; cap: number }
  | { type: "moderator-synthesis"; content: string }
  | { type: "moderator-error"; error: string }
  | { type: "paused" }
  | { type: "resumed" }
  | { type: "injected"; message: string }
  | { type: "force-vote" };

export interface CouncilResult {
  question: string;
  /** Every round's positions, in order. `rounds[0]` is the independent-answer round. */
  rounds: MemberPosition[][];
  consensusReached: boolean;
  /** Index of the last round that actually ran (may be < maxRounds - 1 if consensus was reached early). */
  finalRound: number;
  /** True if the debate stopped early because accumulated spend met or exceeded `budgetCap`, rather
   * than reaching consensus or `maxRounds`. */
  budgetExceeded: boolean;
  dropped: DroppedMember[];
  /** The moderator's synthesized final answer, or a deterministic fallback summary if the moderator's
   * provider errored (see `moderatorError`) — the completed debate is never discarded on a moderator failure. */
  answer: string;
  /** Set if the moderator's provider errored while synthesizing; `answer` is then a fallback summary. */
  moderatorError?: string;
  /** One entry per round (>0) whose alignment-judging call succeeded; rounds where the judge call
   * failed, or round 0, are simply absent — a failure here never fails or discards the debate. */
  alignmentScores: RoundAlignment[];
  /** True if `CouncilController.forceVote()` cut the debate short before consensus or the round cap. */
  forcedVote?: boolean;
}

/**
 * Caller-held handle for mid-debate control, passed to `Council.run()`. `Council` checks in with
 * it between rounds and between each member's turn within a round — the only points where it's
 * safe to act, since an in-flight provider call itself can't be aborted (see `ChatProvider`, which
 * has no cancellation signal). Safe to hold onto and call from a UI event handler at any time;
 * calls before the next checkpoint are simply queued (e.g. `pause()` takes effect at the next
 * checkpoint, not mid-request).
 */
export class CouncilController {
  private paused = false;
  private resumeWaiters: Array<() => void> = [];
  private forceVoteRequested = false;
  private pendingInjection: string | undefined;

  get isPaused(): boolean {
    return this.paused;
  }

  /** Halts the debate at the next checkpoint (before the next member's turn or round) until `resume()`. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Queues a message every surviving member sees at the start of the next round's prompt. A
   * second call before the next round starts overwrites the first — only the latest is delivered. */
  inject(message: string): void {
    this.pendingInjection = message;
  }

  /** Requests that the debate stop asking further members — as soon as the current checkpoint is
   * reached — and move straight to the moderator's synthesis using whatever positions exist so far.
   * Also resumes a paused debate, since a paused checkpoint is stuck waiting on `resume()` and would
   * otherwise never reach the point where the force-vote request is consumed. */
  forceVote(): void {
    this.forceVoteRequested = true;
    if (this.paused) this.resume();
  }

  /** @internal Resolves immediately unless paused, in which case it resolves on the next `resume()`. */
  waitForResume(): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((resolve) => this.resumeWaiters.push(resolve));
  }

  /** @internal Consumes (clears) any pending injection. */
  consumeInjection(): string | undefined {
    const message = this.pendingInjection;
    this.pendingInjection = undefined;
    return message;
  }

  /** @internal Consumes (clears) a pending force-vote request. */
  consumeForceVote(): boolean {
    const requested = this.forceVoteRequested;
    this.forceVoteRequested = false;
    return requested;
  }
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
  private readonly maxRounds: number;
  private readonly budgetCap?: number;
  private readonly estimateCost?: (member: CouncilMember, content: string) => number;
  private readonly onEvent?: (event: CouncilEvent) => void;
  private readonly moderator: CouncilMember;

  constructor(options: CouncilOptions) {
    if (options.members.length < MIN_MEMBERS || options.members.length > MAX_MEMBERS) {
      throw new Error(
        `Council requires between ${MIN_MEMBERS} and ${MAX_MEMBERS} members, got ${options.members.length}`,
      );
    }
    this.members = options.members;
    this.maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
    this.budgetCap = options.budgetCap;
    this.estimateCost = options.estimateCost;
    this.onEvent = options.onEvent;
    this.moderator = options.moderator ?? this.members[0]!;
  }

  /**
   * Runs one debate. `controller` is optional — omitting it (or leaving it untouched) reproduces
   * the original start-to-finish behavior exactly, since every checkpoint is a no-op without one.
   */
  async run(question: string, controller?: CouncilController): Promise<CouncilResult> {
    const rounds: MemberPosition[][] = [];
    const dropped: DroppedMember[] = [];
    const alignmentScores: RoundAlignment[] = [];
    let active = this.members;
    let consensusReached = false;
    let budgetExceeded = false;
    let spent = 0;
    let finalRound = 0;
    let forcedVote = false;

    for (let round = 0; round < this.maxRounds && active.length > 0; round++) {
      if (await this.checkpoint(controller)) {
        forcedVote = true;
        this.onEvent?.({ type: "force-vote" });
        break;
      }

      this.onEvent?.({ type: "round-start", round });

      const positions: MemberPosition[] = [];
      const survivors: CouncilMember[] = [];
      const previousPositions = rounds.at(-1);
      const injected = controller?.consumeInjection();
      if (injected) this.onEvent?.({ type: "injected", message: injected });

      for (const member of active) {
        if (await this.checkpoint(controller)) {
          forcedVote = true;
          break;
        }

        try {
          const position =
            round === 0
              ? await this.askInitial(member, question, injected)
              : await this.askRevision(member, question, previousPositions ?? [], injected);
          positions.push(position);
          survivors.push(member);
          this.onEvent?.({ type: "member-position", round, position });
        } catch (error) {
          const message = classifyProviderError(error).reason;
          const label = member.label ?? member.name;
          dropped.push({ member: member.name, label, round, error: message });
          this.onEvent?.({ type: "member-dropped", round, member: member.name, label, error: message });
        }
      }

      rounds.push(positions);
      active = survivors;
      finalRound = round;

      if (forcedVote) {
        this.onEvent?.({ type: "force-vote" });
        break;
      }

      // Round 0 is independent first answers — there's no leading proposal yet to judge agreement
      // against, so alignment scoring starts at round 1, same as the stance-based consensus check below.
      if (round > 0 && positions.length > 0) {
        const alignment = await this.scoreAlignment(question, round, positions);
        if (alignment) {
          alignmentScores.push(alignment);
          this.onEvent?.({ type: "alignment-scores", round, scores: alignment.scores, average: alignment.average });
        }
      }

      if (round > 0 && positions.length > 0 && positions.every((position) => position.stance === "concur")) {
        consensusReached = true;
        this.onEvent?.({ type: "consensus", round });
        break;
      }

      if (this.estimateCost) {
        for (let i = 0; i < positions.length; i++) {
          spent += this.estimateCost(survivors[i]!, positions[i]!.content);
        }
        if (this.budgetCap !== undefined && spent >= this.budgetCap) {
          budgetExceeded = true;
          this.onEvent?.({ type: "budget-exceeded", round, spent, cap: this.budgetCap });
          break;
        }
      }
    }

    let answer: string;
    let moderatorError: string | undefined;
    try {
      answer = await this.synthesize(question, rounds, dropped, consensusReached, forcedVote);
      this.onEvent?.({ type: "moderator-synthesis", content: answer });
    } catch (error) {
      moderatorError = classifyProviderError(error).reason;
      answer = this.fallbackSynthesis(rounds, dropped, consensusReached, forcedVote);
      this.onEvent?.({ type: "moderator-error", error: moderatorError });
    }

    return {
      question,
      rounds,
      consensusReached,
      finalRound,
      budgetExceeded,
      dropped,
      answer,
      moderatorError,
      alignmentScores,
      forcedVote,
    };
  }

  /** Checks in with `controller` at a safe point (see class doc). Returns `true` if a force-vote
   * request was pending and has now been consumed — the caller must stop asking further members. */
  private async checkpoint(controller: CouncilController | undefined): Promise<boolean> {
    if (!controller) return false;
    if (controller.isPaused) {
      this.onEvent?.({ type: "paused" });
      await controller.waitForResume();
      this.onEvent?.({ type: "resumed" });
    }
    return controller.consumeForceVote();
  }

  private async askInitial(member: CouncilMember, question: string, injected?: string): Promise<MemberPosition> {
    const prompt = injected
      ? [question, "", `Additional context from the moderator: ${injected}`].join("\n")
      : question;
    const response = await member.provider.chat({ messages: this.buildMessages(member, prompt) });
    return { member: member.name, label: member.label ?? member.name, role: member.role, content: response.message.content };
  }

  private async askRevision(
    member: CouncilMember,
    question: string,
    previousPositions: MemberPosition[],
    injected?: string,
  ): Promise<MemberPosition> {
    const labeled = previousPositions
      .map((position) => `${position.label}${position.role ? ` (${position.role})` : ""}: ${position.content}`)
      .join("\n\n");
    const prompt = [
      `Question: ${question}`,
      "",
      "Positions from the previous round:",
      labeled,
      "",
      injected ? `Additional context from the moderator: ${injected}\n` : "",
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
    const label = member.label ?? member.name;
    const concurMatch = CONCUR_PATTERN.exec(content);
    if (concurMatch) {
      const rest = content.slice(concurMatch[0].length).trim();
      return { member: member.name, label, role: member.role, content: rest || content.trim(), stance: "concur" };
    }

    const dissentMatch = DISSENT_PATTERN.exec(content);
    if (dissentMatch) {
      const reason = dissentMatch[1]?.trim();
      const rest = dissentMatch[2]?.trim();
      return {
        member: member.name,
        label,
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
      label,
      role: member.role,
      content: content.trim(),
      stance: "dissent",
      reason: "no explicit stance given",
    };
  }

  /**
   * A second, independent moderator call per round (distinct from the debate turns themselves):
   * asks the moderator to identify the round's leading proposal and score each member's agreement
   * with it 0-10, per the product spec's convergence check. Best-effort like `synthesize`'s Decision
   * Brief format — no structured-output contract is enforced, so a provider error or an answer that
   * doesn't follow the requested format just yields no score for this round rather than failing the
   * round (or the whole debate).
   */
  private async scoreAlignment(
    question: string,
    round: number,
    positions: MemberPosition[],
  ): Promise<RoundAlignment | null> {
    const labeled = positions
      .map((position) => `${position.label}${position.role ? ` (${position.role})` : ""}: ${position.content}`)
      .join("\n\n");
    const prompt = [
      `Question: ${question}`,
      "",
      `Round ${round} positions:`,
      labeled,
      "",
      "Identify the leading proposal among these positions. Then, for each participant listed above, rate how " +
        "closely its position aligns with that leading proposal, from 0 (strongly disagrees) to 10 (fully " +
        'agrees). Respond with exactly one line per participant, in this format: "<name>: <score>/10 - ' +
        '<one-line reason>", using each participant\'s name exactly as given above.',
    ].join("\n");

    let content: string;
    try {
      const response = await this.moderator.provider.chat({ messages: this.buildMessages(this.moderator, prompt) });
      content = response.message.content;
    } catch {
      return null;
    }

    const scores = positions
      .map((position) => this.parseAlignmentScore(position, content))
      .filter((score): score is AlignmentScore => score !== null);
    if (scores.length === 0) return null;

    const average = scores.reduce((sum, score) => sum + score.score, 0) / scores.length;
    return { round, scores, average };
  }

  private parseAlignmentScore(position: MemberPosition, content: string): AlignmentScore | null {
    const escaped = position.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = new RegExp(`${escaped}\\s*:\\s*(\\d{1,2})\\s*/\\s*10\\s*[-–—:]*\\s*(.*)`, "i").exec(content);
    if (!match) return null;
    const score = Number(match[1]);
    if (Number.isNaN(score)) return null;
    const justification = match[2]?.trim();
    return {
      member: position.member,
      label: position.label,
      score: Math.max(0, Math.min(10, score)),
      justification: justification || undefined,
    };
  }

  private async synthesize(
    question: string,
    rounds: MemberPosition[][],
    dropped: DroppedMember[],
    consensusReached: boolean,
    forcedVote: boolean,
  ): Promise<string> {
    const moderator = this.moderator;
    const finalPositions = rounds.at(-1) ?? [];
    const dissenting = finalPositions.filter((position) => position.stance === "dissent");

    const transcript = rounds
      .map((positions, round) => {
        const lines = positions.map((position) => {
          const role = position.role ? ` (${position.role})` : "";
          const stance = position.stance ? ` [${position.stance}${position.reason ? `: ${position.reason}` : ""}]` : "";
          return `- ${position.label}${role}${stance}: ${position.content}`;
        });
        return `Round ${round}:\n${lines.join("\n")}`;
      })
      .join("\n\n");

    const droppedNote = dropped.length
      ? `\nMembers dropped from the debate after a provider error: ${dropped
          .map((member) => `${member.label} (round ${member.round}: ${member.error})`)
          .join(", ")}.`
      : "";

    const outcomeNote = consensusReached
      ? "The council reached unanimous consensus. Write the final answer."
      : forcedVote
        ? `A vote was forced early, after ${rounds.length} round(s), before consensus was reached. Write the best ` +
          "final answer from the positions gathered so far, explicitly noting the unresolved dissent below."
        : `The council did not reach unanimous consensus within ${rounds.length} round(s). Write the best final ` +
          "answer, explicitly noting the unresolved dissent below.";

    const dissentNote = dissenting.length
      ? `\nUnresolved dissent:\n${dissenting
          .map((position) => `- ${position.label}: ${position.reason ?? "no reason given"}`)
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
    forcedVote: boolean,
  ): string {
    const finalPositions = rounds.at(-1) ?? [];
    const dissenting = finalPositions.filter((position) => position.stance === "dissent");

    const consensusNote = consensusReached
      ? "The council reached unanimous consensus, but the moderator's provider errored while synthesizing a final answer."
      : forcedVote
        ? `A vote was forced early, after ${rounds.length} round(s), before consensus was reached, and the ` +
          "moderator's provider errored while synthesizing a final answer."
        : `The council did not reach unanimous consensus within ${rounds.length} round(s), and the moderator's ` +
          "provider errored while synthesizing a final answer.";

    const droppedNote = dropped.length
      ? ` Members dropped from the debate after a provider error: ${dropped
          .map((member) => `${member.label} (round ${member.round})`)
          .join(", ")}.`
      : "";

    const dissentNote = dissenting.length
      ? `\nUnresolved dissent:\n${dissenting
          .map((position) => `- ${position.label}: ${position.reason ?? "no reason given"}`)
          .join("\n")}`
      : "";

    const positionLines = finalPositions
      .map((position) => `- ${position.label}${position.role ? ` (${position.role})` : ""}: ${position.content}`)
      .join("\n");

    return [`${consensusNote}${droppedNote}`, dissentNote, "", "Final positions:", positionLines]
      .filter((line) => line !== "")
      .join("\n");
  }
}
