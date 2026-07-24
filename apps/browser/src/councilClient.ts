import type { CouncilEvent, CouncilMember, CouncilResult } from "@newvector/core";
import { Council, createProvider } from "@newvector/core";
import type { Account, CouncilMemberConfig } from "./types";

/**
 * Runs one council debate for a saved roster of member configs, resolving each member's account
 * into a live `ChatProvider` first. Mirrors `agentClient.runSessionTurn`'s "build fresh per call"
 * shape — a council session persists only the transcript, not runner/provider state. The council
 * engine identifies members by `CouncilMember.name`; that's set to the member config id here so
 * `councilReducer.applyCouncilEvent` can resolve display labels/cost notes back from it.
 */
export function runCouncilTurn(
  members: CouncilMemberConfig[],
  accounts: Account[],
  maxRounds: number | undefined,
  question: string,
  onEvent: (event: CouncilEvent) => void,
): Promise<CouncilResult> {
  const councilMembers: CouncilMember[] = members.map((member) => {
    const account = accounts.find((candidate) => candidate.id === member.accountId);
    if (!account) throw new Error(`Council member references an unknown account: ${member.accountId}`);
    const provider = createProvider({
      provider: account.provider,
      model: account.model,
      apiKey: account.apiKey,
      baseURL: account.baseURL,
      authType: account.authType,
      accessToken: account.oauth?.accessToken,
    });
    return { name: member.id, provider, role: member.role };
  });

  const council = new Council({ members: councilMembers, maxRounds, onEvent });
  return council.run(question);
}
