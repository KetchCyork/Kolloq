/**
 * Scaffold only — there is no plugin marketplace/install system yet. Structure matches spec §7
 * ("marketplace browser plus installed list; each plugin expands to show what it bundles").
 */
export function SettingsPluginsPane() {
  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Plugins</h3>
        <div className="spacer" />
        <button type="button" className="primary-btn" disabled title="Plugins aren't available yet.">
          Browse marketplace
        </button>
      </div>
      <div className="empty-state">
        Plugins — bundles of skills, connectors, and commands you install as a set — aren't built yet. This tab will
        list installed plugins and a marketplace browser once that system lands.
      </div>
    </div>
  );
}
