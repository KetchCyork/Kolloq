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
): string {
  const estimates = rounds
    .flat()
    .map((position) => estimateCost(providerForMember(position.memberId, members, accounts), position.content));
  if (answer) {
    estimates.push(estimateCost(providerForMember(members[0]?.id ?? "", members, accounts), answer));
  }
  return formatCostEstimate(sumCostEstimates(estimates));
}
