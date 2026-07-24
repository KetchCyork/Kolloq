import type { CouncilEvent } from "@newvector/core";
import { estimateCost, formatCostEstimate, sumCostEstimates } from "./costEstimate";
import type {
  Account,
  CouncilDroppedMember,
  CouncilMemberConfig,
  CouncilMemberPosition,
  LiveCouncilTurn,
  ProviderName,
} from "./types";

export const MIN_COUNCIL_MEMBERS = 2;
export const MAX_COUNCIL_MEMBERS = 5;

/** Mirrors `Council`'s own default (`packages/core/src/agent/council.ts`) so the UI can show a
 * round cap even for sessions saved before `maxRounds` was configurable. */
export const DEFAULT_COUNCIL_MAX_ROUNDS = 4;
export const MIN_COUNCIL_MAX_ROUNDS = 2;
export const MAX_COUNCIL_MAX_ROUNDS = 8;

const TYPICAL_RESPONSE_CHARS = 300 * 4; // ~300 tokens, a typical debate-round reply
const TYPICAL_SYNTHESIS_CHARS = 400 * 4; // ~400 tokens, a typical moderator synthesis

export interface CouncilCostRangeEstimate {
  lowUsd: number;
  highUsd: number;
  allFree: boolean;
}

/** Rough pre-debate cost estimate for the setup screen's "Estimated cost" line. No responses exist
 * yet, so this assumes a typical-length reply per member per round (plus one moderator synthesis),
 * ranging from consensus reached halfway through `maxRounds` (low) to running every round (high).
 * Purely indicative, like every other cost note in this app — see costEstimate.ts. */
export function estimateCouncilCostRange(
  members: CouncilMemberConfig[],
  accounts: Account[],
  maxRounds: number,
  moderatorAccountId?: string,
): CouncilCostRangeEstimate {
  const placeholder = "x".repeat(TYPICAL_RESPONSE_CHARS);
  const perRoundEstimates = members.map((member) =>
    estimateCost(accounts.find((account) => account.id === member.accountId)?.provider, placeholder),
  );
  const perRound = sumCostEstimates(perRoundEstimates);

  const moderatorAccount =
    accounts.find((account) => account.id === moderatorAccountId) ??
    accounts.find((account) => account.id === members[0]?.accountId);
  const synthesis = estimateCost(moderatorAccount?.provider, "x".repeat(TYPICAL_SYNTHESIS_CHARS));

  const lowRounds = Math.max(1, Math.ceil(maxRounds / 2));
  return {
    lowUsd: perRound.usd * lowRounds + synthesis.usd,
    highUsd: perRound.usd * maxRounds + synthesis.usd,
    allFree: perRoundEstimates.every((estimate) => estimate.free) && synthesis.free,
  };
}

export function formatCouncilCostRange(estimate: CouncilCostRangeEstimate): string {
  if (estimate.allFree) return "~free (local)";
  // 4 decimals, matching formatCostEstimate — a $0.00-$0.00 range on cheap models would otherwise
  // read as "this is free" when it isn't.
  return `~$${estimate.lowUsd.toFixed(4)}–$${estimate.highUsd.toFixed(4)}`;
}

/** Validates a council's member list before it can be saved or asked a question. Returns a
 * human-readable error, or `null` when the members are valid. */
export function validateCouncilMembers(members: CouncilMemberConfig[], accounts: Account[]): string | null {
  if (members.length < MIN_COUNCIL_MEMBERS) {
    return `A council needs at least ${MIN_COUNCIL_MEMBERS} members.`;
  }
  if (members.length > MAX_COUNCIL_MEMBERS) {
    return `A council can have at most ${MAX_COUNCIL_MEMBERS} members.`;
  }
  for (const member of members) {
    if (!member.accountId) return "Every council member needs an account.";
    if (!accounts.some((account) => account.id === member.accountId)) {
      return "One or more council members reference an account that no longer exists.";
    }
  }
  const seen = new Set<string>();
  for (const member of members) {
    if (seen.has(member.accountId)) return "Each council member must use a different account.";
    seen.add(member.accountId);
  }
  return null;
}

/** Encourages model diversity per the product spec (§6.2.2): counts distinct providers across the
 * roster's resolved accounts and returns a ready-to-render hint, or `null` once there are too few
 * members to judge (the empty/one-member states are already covered by `validateCouncilMembers`). */
export function diversityHint(members: CouncilMemberConfig[], accounts: Account[]): string | null {
  if (members.length < 2) return null;
  const providers = new Set(
    members.map((member) => accounts.find((account) => account.id === member.accountId)?.provider).filter(Boolean),
  );
  if (providers.size >= 2) {
    return `✓ Good model diversity — ${providers.size} provider${providers.size === 1 ? "" : "s"} represented.`;
  }
  return "⚠ All seats use the same provider — consider diversifying for a stronger debate.";
}

function memberLabel(memberId: string, members: CouncilMemberConfig[], accounts: Account[]): string {
  const config = members.find((candidate) => candidate.id === memberId);
  const account = config ? accounts.find((candidate) => candidate.id === config.accountId) : undefined;
  return account ? `${account.label} · ${account.model}` : memberId;
}

function providerForMember(
  memberId: string,
  members: CouncilMemberConfig[],
  accounts: Account[],
): ProviderName | undefined {
  const config = members.find((candidate) => candidate.id === memberId);
  if (!config) return undefined;
  return accounts.find((account) => account.id === config.accountId)?.provider;
}

export function initialLiveCouncilTurn(question: string, maxRounds: number): LiveCouncilTurn {
  return { question, rounds: [], currentRound: 0, maxRounds, dropped: [], consensusReached: false, finished: false };
}

/**
 * Pure reducer turning one streamed `CouncilEvent` (from the Phase 1 `Council` engine) into the
 * next live-transcript state. Kept free of React state/effects so it can be unit tested directly
 * and reused as-is inside the store's `setState` updater.
 */
export function applyCouncilEvent(
  turn: LiveCouncilTurn,
  event: CouncilEvent,
  members: CouncilMemberConfig[],
  accounts: Account[],
): LiveCouncilTurn {
  switch (event.type) {
    case "round-start": {
      const rounds = [...turn.rounds];
      rounds[event.round] = rounds[event.round] ?? [];
      return { ...turn, rounds, currentRound: event.round };
    }
    case "member-position": {
      const memberId = event.position.member;
      const position: CouncilMemberPosition = {
        memberId,
        label: memberLabel(memberId, members, accounts),
        role: event.position.role,
        content: event.position.content,
        stance: event.position.stance,
        reason: event.position.reason,
        costNote: formatCostEstimate(
          estimateCost(providerForMember(memberId, members, accounts), event.position.content),
        ),
      };
      const rounds = [...turn.rounds];
      rounds[event.round] = [...(rounds[event.round] ?? []), position];
      return { ...turn, rounds };
    }
    case "member-dropped": {
      const dropped: CouncilDroppedMember = {
        memberId: event.member,
        label: memberLabel(event.member, members, accounts),
        round: event.round,
        error: event.error,
      };
      return { ...turn, dropped: [...turn.dropped, dropped] };
    }
    case "consensus":
      return { ...turn, consensusReached: true };
    case "moderator-synthesis":
      return { ...turn, answer: event.content, finished: true };
    case "moderator-error":
      return { ...turn, moderatorError: event.error, finished: true };
    default:
      return turn;
  }
}

export type CouncilOutcome = "consensus" | "cap-hit" | "all-dropped";

/**
 * Classifies why a finished turn's debate stopped, so the UI can tell a real "no consensus" apart
 * from the round cap simply being reached. `Council.run()`'s loop only ever ends one of three ways:
 * unanimous concurrence, the round cap, or every remaining member dropping out mid-round — so once
 * consensus and "last round had zero positions" are ruled out, the round cap is the only case left.
 */
export function classifyCouncilOutcome(params: {
  consensusReached: boolean;
  lastRoundPositionCount: number;
}): CouncilOutcome {
  if (params.consensusReached) return "consensus";
  if (params.lastRoundPositionCount === 0) return "all-dropped";
  return "cap-hit";
}

/** Sums per-position cost estimates (re-derived from stored content, not stored twice) plus the
 * moderator's synthesis, into one turn-level cost note for the board's cost-visibility preference. */
export function computeTotalCostNote(
  rounds: CouncilMemberPosition[][],
  answer: string | undefined,
  members: CouncilMemberConfig[],
  accounts: Account[],
  moderatorAccountId?: string,
): string {
  const estimates = rounds
    .flat()
    .map((position) => estimateCost(providerForMember(position.memberId, members, accounts), position.content));
  if (answer) {
    const moderatorAccount =
      accounts.find((account) => account.id === moderatorAccountId) ??
      accounts.find((account) => account.id === members[0]?.accountId);
    estimates.push(estimateCost(moderatorAccount?.provider, answer));
  }
  return formatCostEstimate(sumCostEstimates(estimates));
}

/** Approximate 0-100 "alignment" reading for the live sidebar meter: the share of the latest
 * round's respondents who concurred. There's no numeric per-agent agreement score in the engine
 * (see `packages/core/src/agent/council.ts`) — only a binary concur/dissent stance — so this is a
 * deliberately simple proxy, not the 0-10 score the product spec describes. Round 0 has no stance
 * (nothing to agree/disagree with yet), so it reads as `null` until round 1 exists. */
export function computeAlignment(rounds: CouncilMemberPosition[][]): number | null {
  const latestRoundWithStance = rounds.slice(1).at(-1);
  if (!latestRoundWithStance || latestRoundWithStance.length === 0) return null;
  const concurring = latestRoundWithStance.filter((position) => position.stance === "concur").length;
  return Math.round((concurring / latestRoundWithStance.length) * 100);
}

const DECISION_BRIEF_HEADERS = [
  ["recommendation", "Recommendation:"],
  ["rationale", "Rationale:"],
  ["contention", "Key contention & resolution:"],
  ["nextSteps", "Next steps:"],
] as const;

export interface DecisionBriefSections {
  recommendation?: string;
  rationale?: string;
  contention?: string;
  nextSteps?: string;
  /** True once at least one recognized header was found; when false, none of the fields above are
   * populated and callers should fall back to rendering `answer` as-is. */
  structured: boolean;
}

/** Symmetric markdown/quote wrappers models use around headers instead of the requested plain
 * text, e.g. `**Recommendation:**` or `"Recommendation:"`. */
const HEADER_WRAPPERS = ["**", '"', "_"];

/** Locates a header in the moderator's answer, matching either the plain header text or a
 * wrapped form like `**Header:**` or `"Header:"` (some models decorate the headers despite the
 * plain-text instruction). Prefers a wrapped match when present so the match — and the boundary
 * it creates between sections — includes the surrounding decoration, keeping stray markdown out
 * of section content. */
function findHeaderMatch(answer: string, header: string): { index: number; length: number } | null {
  const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const wrapper of HEADER_WRAPPERS) {
    const escapedWrapper = wrapper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const wrappedMatch = new RegExp(`${escapedWrapper}\\s*${escaped}\\s*${escapedWrapper}`).exec(answer);
    if (wrappedMatch) return { index: wrappedMatch.index, length: wrappedMatch[0].length };
  }
  const plainIndex = answer.indexOf(header);
  return plainIndex === -1 ? null : { index: plainIndex, length: header.length };
}

/** Strips leading/trailing lines that are bare markdown decoration (e.g. a lone `**` or `"`)
 * left over when a header's wrapper isn't symmetric enough for `findHeaderMatch` to consume both
 * sides — for example a stray closing `**` carried over from the previous section, or a trailing
 * `_` the model left dangling at the end of the answer. */
function stripStrayDecorationLines(text: string): string {
  const lines = text.split("\n");
  const isBareDecoration = (line: string) => /^[*_"]+$/.test(line.trim());
  while (lines.length > 0 && isBareDecoration(lines[0])) lines.shift();
  while (lines.length > 0 && isBareDecoration(lines[lines.length - 1])) lines.pop();
  return lines.join("\n").trim();
}

/** Best-effort split of the moderator's plain-text synthesis into Decision Brief sections. The
 * moderator is asked (see `DECISION_BRIEF_FORMAT` in council.ts) to use these exact headers, but
 * nothing enforces it server-side, so a model that ignores the instruction just falls through to
 * `structured: false` and the caller renders the raw answer instead. */
export function parseDecisionBrief(answer: string): DecisionBriefSections {
  const positions = DECISION_BRIEF_HEADERS.flatMap(([key, header]) => {
    const match = findHeaderMatch(answer, header);
    return match ? [{ key, index: match.index, length: match.length }] : [];
  });

  if (positions.length === 0) return { structured: false };

  positions.sort((a, b) => a.index - b.index);
  const sections: DecisionBriefSections = { structured: true };
  positions.forEach((entry, i) => {
    const start = entry.index + entry.length;
    const end = positions[i + 1]?.index ?? answer.length;
    sections[entry.key] = stripStrayDecorationLines(answer.slice(start, end));
  });
  return sections;
}
