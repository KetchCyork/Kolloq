import type { CouncilEvent, CouncilMember, CouncilResult } from "@newvector/core";
import { Council, createProvider } from "@newvector/core";
import { estimateCost } from "./costEstimate";
import { getProviderFetch } from "./providerFetch";
import type { Account, CouncilMemberConfig } from "./types";

function providerForAccount(account: Account) {
  return createProvider({
    provider: account.provider,
    model: account.model,
    apiKey: account.apiKey,
    baseURL: account.baseURL,
    authType: account.authType,
    accessToken: account.oauth?.accessToken,
    // Desktop shell: route inference through Rust so provider APIs aren't CORS-blocked by the webview.
    fetchImpl: getProviderFetch(),
  });
}

/**
 * Runs one council debate for a saved roster of member configs, resolving each member's account
 * into a live `ChatProvider` first. Mirrors `agentClient.runSessionTurn`'s "build fresh per call"
 * shape — a council session persists only the transcript, not runner/provider state. The council
 * engine identifies members by `CouncilMember.name`; that's set to the member config id here so
 * `councilReducer.applyCouncilEvent` can resolve display labels/cost notes back from it. `label` is
 * set separately to the account's human-readable name — the engine embeds `label` (never `name`) in
 * any prompt/transcript text, so the opaque member id never reaches a moderator prompt or a
 * user-visible transcript/synthesis. The moderator never debates — it's built and passed
 * separately (see `moderatorAccountId`).
 */
export function runCouncilTurn(
  members: CouncilMemberConfig[],
  accounts: Account[],
  maxRounds: number | undefined,
  moderatorAccountId: string | undefined,
  question: string,
  onEvent: (event: CouncilEvent) => void,
  budgetCap?: number,
): Promise<CouncilResult> {
  const councilMembers: CouncilMember[] = members.map((member) => {
    const account = accounts.find((candidate) => candidate.id === member.accountId);
    if (!account) throw new Error(`Council member references an unknown account: ${member.accountId}`);
    return {
      name: member.id,
      label: `${account.label} · ${account.model}`,
      provider: providerForAccount(account),
      role: member.role,
    };
  });

  // No explicit moderator account (or it no longer exists): fall back to members[0]'s account,
  // matching Council's own default — the same provider both debates and synthesizes, as before
  // this option existed.
  const moderatorAccount =
    (moderatorAccountId && accounts.find((candidate) => candidate.id === moderatorAccountId)) ||
    accounts.find((candidate) => candidate.id === members[0]?.accountId);
  if (!moderatorAccount) throw new Error("Council has no valid moderator account.");
  const moderator: CouncilMember = { name: "moderator", provider: providerForAccount(moderatorAccount) };

  // The engine identifies members by `CouncilMember.name` (set to the member config id above, plus
  // the fixed "moderator" name), so mirror that here to look pricing back up per position — the
  // engine itself has no notion of provider pricing (see costEstimate.ts), only what this callback
  // reports. Same per-provider rate table the live cost display already uses, so the hard stop and
  // the on-screen running total agree.
  const providerByMemberName = new Map(
    members
      .map((member) => [member.id, accounts.find((candidate) => candidate.id === member.accountId)?.provider] as const)
      .filter((entry): entry is [string, Account["provider"]] => Boolean(entry[1])),
  );
  providerByMemberName.set("moderator", moderatorAccount.provider);

  const council = new Council({
    members: councilMembers,
    moderator,
    maxRounds,
    onEvent,
    budgetCap,
    estimateCost:
      budgetCap !== undefined
        ? (member, content) => estimateCost(providerByMemberName.get(member.name), content).usd
        : undefined,
  });
  return council.run(question);
}
