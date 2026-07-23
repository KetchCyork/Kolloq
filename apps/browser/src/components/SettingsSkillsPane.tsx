/**
 * Scaffold only — there is no skills system yet (attach/toggle, marketplace, per-agent defaults).
 * Structure matches spec §7 ("installed skills with per-skill toggle, source, and 'attach by
 * default to...' agent picker") so the tab lands in the right place once that backend exists.
 */
export function SettingsSkillsPane() {
  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Skills</h3>
        <div className="spacer" />
        <button type="button" className="primary-btn" disabled title="Skills aren't available yet.">
          + Add skill
        </button>
      </div>
      <div className="empty-state">
        Skills — reusable local files, marketplace add-ons, and per-agent attachments — aren't built yet. This tab
        will list installed skills with a toggle, source, and default-attachment picker once that system lands.
      </div>
    </div>
  );
}
