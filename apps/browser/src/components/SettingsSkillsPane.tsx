import { useRef, useState } from "react";
import { parseSkillFile } from "../skills";
import { useStore } from "../store";
import type { Skill, SkillSource } from "../types";

/**
 * Installed skills (spec §7): per-skill toggle, source, and an "attach to agents" picker. Skills are
 * installed by pasting a SKILL.md body or importing a local `.md` file; marketplace and URL sources
 * from the spec aren't offered yet (no catalog, and no CORS-safe fetch path from the browser build).
 */
interface DraftSkill {
  name: string;
  description: string;
  instructions: string;
  source: SkillSource;
  sourceLabel?: string;
  attachedAgentIds: string[];
}

function blankDraft(): DraftSkill {
  return { name: "", description: "", instructions: "", source: "pasted", attachedAgentIds: [] };
}

function draftFromSkill(skill: Skill): DraftSkill {
  return {
    name: skill.name,
    description: skill.description,
    instructions: skill.instructions,
    source: skill.source,
    sourceLabel: skill.sourceLabel,
    attachedAgentIds: [...skill.attachedAgentIds],
  };
}

const SOURCE_LABELS: Record<SkillSource, string> = { pasted: "Pasted", "local-file": "Local file" };

export function SettingsSkillsPane() {
  const { skills, sessions, createSkill, updateSkill, deleteSkill, setSkillAttached } = useStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftSkill>(blankDraft());
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function startAdd() {
    setDraft(blankDraft());
    setEditingId(null);
    setError(null);
    setAdding(true);
  }

  function startEdit(skill: Skill) {
    setDraft(draftFromSkill(skill));
    setEditingId(skill.id);
    setError(null);
    setAdding(true);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setError(null);
  }

  /** Reads a picked `.md`/`.txt` file into the draft, pre-filling name/description from frontmatter. */
  async function importFile(file: File) {
    const text = await file.text();
    const parsed = parseSkillFile(text, file.name);
    setError(null);
    setDraft((prev) => ({
      ...prev,
      name: parsed.name || prev.name,
      description: parsed.description || prev.description,
      instructions: parsed.instructions,
      source: "local-file",
      sourceLabel: file.name,
    }));
  }

  function save() {
    const instructions = draft.instructions.trim();
    if (!instructions) {
      setError("Add the skill's instructions (or import a SKILL.md file) before saving.");
      return;
    }
    // A pasted body may itself be a full SKILL.md — read its frontmatter so the user doesn't have to
    // retype the name, but never override a name they typed.
    const parsed = parseSkillFile(instructions, draft.sourceLabel);
    const name = draft.name.trim() || parsed.name.trim();
    if (!name) {
      setError("Give the skill a name.");
      return;
    }
    const description = draft.description.trim() || parsed.description.trim();

    if (editingId) {
      updateSkill(editingId, {
        name,
        description,
        instructions,
        source: draft.source,
        sourceLabel: draft.sourceLabel,
        attachedAgentIds: draft.attachedAgentIds,
      });
    } else {
      createSkill({
        name,
        description,
        instructions,
        source: draft.source,
        sourceLabel: draft.sourceLabel,
        enabled: true,
        attachedAgentIds: draft.attachedAgentIds,
      });
    }
    cancelForm();
  }

  function remove(skill: Skill) {
    if (window.confirm(`Delete skill "${skill.name}"? Agents using it lose those instructions.`)) {
      deleteSkill(skill.id);
      if (editingId === skill.id) cancelForm();
    }
  }

  function toggleDraftAgent(agentId: string) {
    setDraft((prev) => ({
      ...prev,
      attachedAgentIds: prev.attachedAgentIds.includes(agentId)
        ? prev.attachedAgentIds.filter((candidate) => candidate !== agentId)
        : [...prev.attachedAgentIds, agentId],
    }));
  }

  function attachedNames(skill: Skill): string {
    const names = skill.attachedAgentIds
      .map((id) => sessions.find((session) => session.id === id)?.identity.name)
      .filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(", ") : "No agents yet";
  }

  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Skills</h3>
        <div className="spacer" />
        {!adding && (
          <button type="button" className="primary-btn" onClick={startAdd}>
            + Add skill
          </button>
        )}
      </div>

      {skills.length === 0 && !adding && (
        <div className="empty-state">
          No skills yet. A skill is a reusable instruction package (SKILL.md-style) — "our brand voice", "board memo
          format" — that you attach to agents so you don't repeat it in every prompt.
        </div>
      )}

      {skills.length > 0 && (
        <div className="settings-grid">
          {skills.map((skill) => (
            <div className="settings-card" key={skill.id}>
              <div className="settings-card-row">
                <div>
                  <h3>{skill.name}</h3>
                  <div className="settings-card-sub">
                    {SOURCE_LABELS[skill.source]}
                    {skill.sourceLabel ? ` · ${skill.sourceLabel}` : ""}
                    {skill.description ? ` — ${skill.description}` : ""}
                  </div>
                </div>
                <label className="toggle-switch skill-card-toggle" aria-label={`Enable ${skill.name}`}>
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    onChange={(e) => updateSkill(skill.id, { enabled: e.target.checked })}
                  />
                  <span className="toggle-track" />
                </label>
              </div>
              <div className="settings-card-sub">Attached to: {attachedNames(skill)}</div>
              <div className="settings-kv">
                <button type="button" className="settings-btn" onClick={() => startEdit(skill)}>
                  Edit
                </button>
                <button type="button" className="settings-btn" onClick={() => remove(skill)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="settings-card">
          <div className="settings-form-grid">
            <div className="field">
              <label htmlFor="skill-name">Name</label>
              <input
                id="skill-name"
                placeholder="e.g. Board memo format"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>

            <div className="field">
              <label htmlFor="skill-description">When to use it</label>
              <input
                id="skill-description"
                placeholder="e.g. Any memo written for the board"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>

            <div className="field span-full">
              <label htmlFor="skill-instructions">Instructions</label>
              <textarea
                id="skill-instructions"
                placeholder={"Paste a SKILL.md body, or write the instructions directly."}
                value={draft.instructions}
                onChange={(e) =>
                  setDraft({ ...draft, instructions: e.target.value, source: "pasted", sourceLabel: undefined })
                }
              />
              <div className="settings-note">
                Or import a file — frontmatter <code>name</code> and <code>description</code> are read automatically.
              </div>
              <div className="template-chip-row">
                <button type="button" className="settings-btn" onClick={() => fileInput.current?.click()}>
                  Import .md file…
                </button>
                {draft.source === "local-file" && draft.sourceLabel && (
                  <span className="settings-card-sub">Imported from {draft.sourceLabel}</span>
                )}
              </div>
              <input
                ref={fileInput}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                className="skill-file-input"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void importFile(file);
                }}
              />
            </div>

            <div className="field span-full">
              <label>Attach to agents</label>
              {sessions.length === 0 ? (
                <div className="settings-note">
                  No agents yet. Create an agent first, then attach this skill from here or from the agent itself.
                </div>
              ) : (
                <div className="template-chip-row">
                  {sessions.map((session) => (
                    <label key={session.id} className="skill-agent-option">
                      <input
                        type="checkbox"
                        checked={draft.attachedAgentIds.includes(session.id)}
                        onChange={() => toggleDraftAgent(session.id)}
                      />
                      <span className="agent-card-dot" style={{ background: session.identity.color }} />
                      {session.identity.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div className="field span-full">
                <div className="field-hint field-hint-error">{error}</div>
              </div>
            )}

            <div className="field span-full account-form-actions">
              <button type="button" className="settings-btn" onClick={cancelForm}>
                Cancel
              </button>
              <button type="button" className="primary-btn" onClick={save}>
                {editingId ? "Save skill" : "Add skill"}
              </button>
            </div>
          </div>
          <div className="settings-note">
            Attached, enabled skills are appended to the agent's system prompt on its next message. Skills stay on this
            device.
          </div>
        </div>
      )}

      {skills.length > 0 && sessions.length > 0 && !adding && (
        <div className="settings-card">
          <h3>Attachments</h3>
          <div className="settings-card-sub">Which agents use each skill. Toggle to attach or detach.</div>
          {skills.map((skill) => (
            <div className="field span-full" key={skill.id}>
              <label>{skill.name}</label>
              <div className="template-chip-row">
                {sessions.map((session) => (
                  <label key={session.id} className="skill-agent-option">
                    <input
                      type="checkbox"
                      checked={skill.attachedAgentIds.includes(session.id)}
                      onChange={(e) => setSkillAttached(skill.id, session.id, e.target.checked)}
                    />
                    <span className="agent-card-dot" style={{ background: session.identity.color }} />
                    {session.identity.name}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
