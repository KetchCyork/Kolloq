import type { AgentSession } from "../types";

export function SessionSettingsForm({
  session,
  onChange,
}: {
  session: AgentSession;
  onChange: (patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt" | "multiAgent">>) => void;
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

      <div className="field span-full">
        <label htmlFor="multi-agent-toggle">
          <input
            id="multi-agent-toggle"
            type="checkbox"
            checked={session.multiAgent?.enabled ?? false}
            onChange={(e) => onChange({ multiAgent: { ...session.multiAgent, enabled: e.target.checked } })}
          />{" "}
          Multi-agent (experimental)
        </label>
        <p className="field-hint">
          Lets {identity.name} delegate sub-tasks to fresh sub-agents via a <code>delegate_task</code> tool and
          synthesize their answers. Sub-agent steps appear indented and labeled, live and in the saved transcript.
        </p>
      </div>
    </div>
  );
}
