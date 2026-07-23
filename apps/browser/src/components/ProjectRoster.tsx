import { useStore } from "../store";
import type { Project } from "../types";
import { randomIdentity } from "../utils";

export function ProjectRoster({ project }: { project: Project }) {
  const { accounts, openAccountsManager, addProjectMember, updateProjectMember, removeProjectMember } = useStore();

  function handleAdd() {
    if (accounts.length === 0) {
      window.alert("Add an account first — a roster member needs a model to run on.");
      openAccountsManager();
      return;
    }
    const usedAccountIds = new Set(project.roster.map((member) => member.accountId));
    const account = accounts.find((candidate) => !usedAccountIds.has(candidate.id)) ?? accounts[0];
    addProjectMember(project.id, { accountId: account.id, identity: randomIdentity(project.roster.length) });
  }

  return (
    <>
      <div className="proj-h">Agent roster</div>
      <div className="roster">
        {project.roster.map((member) => (
          <div className="agent-opt roster-member" key={member.id}>
            <span className="dot" style={{ background: member.identity.color }} />
            <div className="roster-member-fields">
              <input
                className="roster-name-input"
                aria-label="Agent name"
                value={member.identity.name}
                onChange={(event) =>
                  updateProjectMember(project.id, member.id, {
                    identity: { ...member.identity, name: event.target.value },
                  })
                }
              />
              <input
                className="roster-role-input"
                aria-label="Role"
                placeholder="Role (optional)"
                value={member.role ?? ""}
                onChange={(event) =>
                  updateProjectMember(project.id, member.id, { role: event.target.value || undefined })
                }
              />
              <select
                className="roster-account-select"
                aria-label="Account"
                value={member.accountId}
                onChange={(event) => updateProjectMember(project.id, member.id, { accountId: event.target.value })}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label} · {account.model}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="roster-remove"
              title={`Remove ${member.identity.name}`}
              onClick={() => removeProjectMember(project.id, member.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <button className="btn small" style={{ marginTop: 4 }} onClick={handleAdd}>
          ＋ Add agent
        </button>
      </div>
    </>
  );
}
