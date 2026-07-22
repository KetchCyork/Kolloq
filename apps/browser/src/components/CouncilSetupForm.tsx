import { diversityHint, MAX_COUNCIL_MEMBERS, MIN_COUNCIL_MEMBERS, validateCouncilMembers } from "../councilReducer";
import { useStore } from "../store";
import type { CouncilMemberConfig, CouncilSession } from "../types";
import { randomId } from "../utils";

const SEAT_COLORS = ["var(--a1)", "var(--a2)", "var(--a3)", "var(--a4)", "var(--a5)"];
const MAX_ROUND_OPTIONS = [2, 4, 6, 8];
const BUDGET_CAP_OPTIONS = [5, 10, 25, 50];

type SessionPatch = Partial<Pick<CouncilSession, "members" | "maxRounds" | "moderatorAccountId" | "budgetCap">>;

/** Council roster + rules editor: min 2, max 5 seats each on its own account with an optional
 * stance label, plus moderator/max-rounds/budget-cap. Used both as the initial setup screen (see
 * `CouncilSetupView`) and to edit an existing session's roster/rules later. */
export function CouncilSetupForm({ session, onChange }: { session: CouncilSession; onChange: (patch: SessionPatch) => void }) {
  const { accounts, openAccountsManager } = useStore();
  const members = session.members;
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
    onChange({ members: [...members, { id: randomId(), accountId: nextAccount.id }] });
  }

  function removeMember(id: string) {
    onChange({ members: members.filter((member) => member.id !== id) });
  }

  function updateMember(id: string, patch: Partial<Omit<CouncilMemberConfig, "id">>) {
    onChange({ members: members.map((member) => (member.id === id ? { ...member, ...patch } : member)) });
  }

  return (
    <div className="council-setup-form">
      <div className="field span-full">
        <label>Council seats — {MIN_COUNCIL_MEMBERS} to {MAX_COUNCIL_MEMBERS} agents</label>
        <div className="council-seats">
          {members.map((member, index) => {
            const seatAccount = accounts.find((account) => account.id === member.accountId);
            return (
              <div className="seat filled" key={member.id}>
                <span className="dot" style={{ background: SEAT_COLORS[index % SEAT_COLORS.length] }} />
                {/* Seat tiles are narrow, so the picker carries the account label only and the model
                 * gets its own line — cramming "label · model" into the select overflowed the tile. */}
                <select
                  aria-label={`Account for council seat ${index + 1}`}
                  title={seatAccount ? `${seatAccount.label} · ${seatAccount.model}` : undefined}
                  value={member.accountId}
                  onChange={(e) => updateMember(member.id, { accountId: e.target.value })}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label}
                    </option>
                  ))}
                </select>
                <small className="seat-model">{seatAccount ? seatAccount.model : "Account removed"}</small>
                <input
                  type="text"
                  className="seat-stance-input"
                  placeholder="Stance (optional)"
                  value={member.role ?? ""}
                  onChange={(e) => updateMember(member.id, { role: e.target.value || undefined })}
                />
                <button
                  type="button"
                  className="seat-remove"
                  onClick={() => removeMember(member.id)}
                  disabled={members.length <= MIN_COUNCIL_MEMBERS}
                  title={
                    members.length <= MIN_COUNCIL_MEMBERS
                      ? `A council needs at least ${MIN_COUNCIL_MEMBERS} members`
                      : "Remove seat"
                  }
                >
                  ✕ Remove
                </button>
              </div>
            );
          })}
          {members.length < MAX_COUNCIL_MEMBERS && (
            <button type="button" className="seat" onClick={addMember}>
              ＋ Add seat
            </button>
          )}
        </div>
        {!validationError && <div className="hint">{diversityHint(members, accounts)}</div>}
        {validationError && <div className="council-setup-error">{validationError}</div>}
      </div>

      <div className="council-rules">
        <div className="field">
          <label>Moderator</label>
          <select
            value={session.moderatorAccountId ?? ""}
            onChange={(e) => onChange({ moderatorAccountId: e.target.value || undefined })}
          >
            <option value="">Same as seat 1 (default)</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label} · {account.model}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Max rounds</label>
          <select
            value={String(session.maxRounds ?? 4)}
            onChange={(e) => onChange({ maxRounds: Number(e.target.value) })}
          >
            {MAX_ROUND_OPTIONS.map((rounds) => (
              <option key={rounds} value={rounds}>
                {rounds}
                {rounds === 4 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Budget cap</label>
          <select
            value={session.budgetCap ? String(session.budgetCap) : ""}
            onChange={(e) => onChange({ budgetCap: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">No cap</option>
            {BUDGET_CAP_OPTIONS.map((cap) => (
              <option key={cap} value={cap}>
                ${cap.toFixed(2)}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
