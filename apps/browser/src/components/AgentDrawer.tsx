import { useEffect, useState } from "react";
import { AGENT_TEMPLATES } from "../agentTemplates";
import { getAgentStatus } from "../agentStatus";
import { useStore } from "../store";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";

export function AgentDrawer({
  agentId,
  mode,
  onClose,
}: {
  agentId: string;
  mode: "create" | "edit";
  onClose: () => void;
}) {
  const { sessions, accounts, skills, updateSession, deleteSession, sendMessage, live, setSkillAttached, openSkillsManager } =
    useStore();
  const [testText, setTestText] = useState("");
  const session = sessions.find((candidate) => candidate.id === agentId);

  // The session backing this drawer was deleted from under it (e.g. via the Delete button below) — close.
  useEffect(() => {
    if (!session) onClose();
  }, [session, onClose]);

  if (!session) return null;

  const status = getAgentStatus(session.providerConfig, accounts);
  const isStreaming = Boolean(live[session.id]);
  const isNew = mode === "create";

  function applyTemplate(templateId: string) {
    const template = AGENT_TEMPLATES.find((candidate) => candidate.id === templateId);
    if (!template || !session) return;
    updateSession(session.id, {
      identity: { ...session.identity, name: template.name },
      systemPrompt: template.systemPrompt,
    });
  }

  function sendTest() {
    const trimmed = testText.trim();
    if (!trimmed || isStreaming || status.status !== "ready") return;
    void sendMessage(session!.id, trimmed);
    setTestText("");
  }

  function remove() {
    if (window.confirm(`Delete "${session!.identity.name}"? This cannot be undone.`)) {
      deleteSession(session!.id);
    }
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="agent-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h2>{isNew ? "New agent" : session.identity.name}</h2>
          <button className="icon-btn" onClick={onClose} title="Close">
            ×
          </button>
        </div>

        <div className="agent-drawer-body">
          {isNew && (
            <div className="field span-full">
              <label>Start from a template (optional)</label>
              <div className="template-chip-row">
                {AGENT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="settings-btn"
                    onClick={() => applyTemplate(template.id)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="settings-panel">
            <div className="field">
              <label htmlFor="agent-drawer-name">Name</label>
              <input
                id="agent-drawer-name"
                value={session.identity.name}
                onChange={(e) => updateSession(session.id, { identity: { ...session.identity, name: e.target.value } })}
              />
            </div>

            <div className="field">
              <label htmlFor="agent-drawer-color">Color</label>
              <input
                id="agent-drawer-color"
                type="color"
                value={session.identity.color}
                onChange={(e) => updateSession(session.id, { identity: { ...session.identity, color: e.target.value } })}
              />
            </div>

            <div className="field span-full">
              <label>Connection</label>
              <ModelPicker
                providerConfig={session.providerConfig}
                onChange={(patch) => updateSession(session.id, { providerConfig: { ...session.providerConfig, ...patch } })}
              />
              {status.status === "error" && <div className="hint agent-drawer-status-error">{status.detail}</div>}
            </div>

            <div className="field span-full">
              <label htmlFor="agent-drawer-prompt">System prompt / persona</label>
              <textarea
                id="agent-drawer-prompt"
                value={session.systemPrompt}
                onChange={(e) => updateSession(session.id, { systemPrompt: e.target.value })}
              />
            </div>

            <div className="field span-full">
              <label>Skills</label>
              {skills.length === 0 ? (
                <div>
                  <div className="settings-note">No skills installed yet. Install one, then attach it here.</div>
                  <div className="template-chip-row">
                    <button type="button" className="settings-btn" onClick={openSkillsManager}>
                      Open Settings → Skills
                    </button>
                  </div>
                </div>
              ) : (
                <div className="template-chip-row">
                  {skills.map((skill) => (
                    <label key={skill.id} className="skill-agent-option" title={skill.description || undefined}>
                      <input
                        type="checkbox"
                        checked={skill.attachedAgentIds.includes(session.id)}
                        onChange={(e) => setSkillAttached(skill.id, session.id, e.target.checked)}
                      />
                      {skill.name}
                      {!skill.enabled && <span className="settings-card-sub"> (off)</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="agent-drawer-test">
            <div className="agent-drawer-test-label">Test this agent</div>
            <MessageList session={session} live={live[session.id]} />
            <div className="agent-drawer-test-composer">
              <input
                placeholder={status.status === "ready" ? "Send a test message…" : "Pick a connection to test this agent"}
                value={testText}
                disabled={status.status !== "ready" || isStreaming}
                onChange={(e) => setTestText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendTest();
                  }
                }}
              />
              <button
                className="settings-btn"
                onClick={sendTest}
                disabled={status.status !== "ready" || isStreaming || !testText.trim()}
              >
                {isStreaming ? "Sending…" : "Send"}
              </button>
            </div>
          </div>
        </div>

        <div className="agent-drawer-footer">
          <button className="settings-btn" onClick={remove}>
            Delete agent
          </button>
          <button className="primary-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
