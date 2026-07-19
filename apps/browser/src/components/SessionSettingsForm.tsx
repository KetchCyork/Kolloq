import type { AgentSession } from "../types";

export function SessionSettingsForm({
  session,
  onChange,
}: {
  session: AgentSession;
  onChange: (patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => void;
}) {
  const { identity, systemPrompt } = session;

  return (
    <div className="settings-panel">
      <div className="field">
        <label htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          value={identity.name}
          onChange={(e) => onChange({ identity: { ...identity, name: e.target.value } })}
        />
      </div>

      <div className="field">
        <label htmlFor="agent-color">Color</label>
        <input
          id="agent-color"
          type="color"
          value={identity.color}
          onChange={(e) => onChange({ identity: { ...identity, color: e.target.value } })}
        />
      </div>

      <div className="field span-full">
        <label htmlFor="system-prompt">System prompt</label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </div>
    </div>
  );
}
