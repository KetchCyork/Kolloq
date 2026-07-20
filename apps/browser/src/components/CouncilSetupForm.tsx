import { MAX_COUNCIL_MEMBERS, MIN_COUNCIL_MEMBERS, validateCouncilMembers } from "../councilReducer";
import { useStore } from "../store";
import type { CouncilMemberConfig } from "../types";
import { randomId } from "../utils";

/** Add/remove/edit a council's member roster: min 2, max 5, each on its own account, with an
 * optional persona/role label. Used both when creating a council and when editing one later. */
export function CouncilSetupForm({
  members,
  onChange,
}: {
  members: CouncilMemberConfig[];
  onChange: (members: CouncilMemberConfig[]) => void;
}) {
  const { accounts, openAccountsManager } = useStore();
  const validationError = validateCouncilMembers(members, accounts);

  if (accounts.length === 0) {
    return (
      <div className="council-setup-empty">
        No saved accounts yet.{" "}
        <button type="button" onClick={openAccountsManager}>
          Add an account
        </button>{" "}
        before setting up a council.
      </div>
    );
  }

  function addMember() {
    const usedAccountIds = new Set(members.map((member) => member.accountId));
    const nextAccount = accounts.find((account) => !usedAccountIds.has(account.id)) ?? accounts[0];
    if (!nextAccount) return;
    onChange([...members, { id: randomId(), accountId: nextAccount.id }]);
  }

  function removeMember(id: string) {
    onChange(members.filter((member) => member.id !== id));
  }

  function updateMember(id: string, patch: Partial<Omit<CouncilMemberConfig, "id">>) {
    onChange(members.map((member) => (member.id === id ? { ...member, ...patch } : member)));
  }

  return (
    <div className="council-setup-form">
      {members.map((member, index) => (
        <div className="council-member-row" key={member.id}>
          <span className="council-member-index">{index + 1}</span>
          <select
            aria-label={`Account for council member ${index + 1}`}
            value={member.accountId}
            onChange={(e) => updateMember(member.id, { accountId: e.target.value })}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.model}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="council-member-role"
            placeholder="Role (optional, e.g. skeptic)"
            value={member.role ?? ""}
            onChange={(e) => updateMember(member.id, { role: e.target.value || undefined })}
          />
          <button
            type="button"
            className="council-member-remove"
            onClick={() => removeMember(member.id)}
            disabled={members.length <= MIN_COUNCIL_MEMBERS}
            title={
              members.length <= MIN_COUNCIL_MEMBERS
                ? `A council needs at least ${MIN_COUNCIL_MEMBERS} members`
                : "Remove member"
            }
          >
            ✕
          </button>
        </div>
      ))}

      <button
        type="button"
        className="council-add-member"
        onClick={addMember}
        disabled={members.length >= MAX_COUNCIL_MEMBERS}
      >
        + Add member
      </button>

      {validationError && <div className="council-setup-error">{validationError}</div>}
    </div>
  );
}
