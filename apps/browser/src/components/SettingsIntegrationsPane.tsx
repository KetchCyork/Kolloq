/**
 * Scaffold only — there is no MCP connector system yet. Structure matches spec §7 ("MCP connector
 * directory and installed connectors, each with granted-permission scopes and a per-agent access
 * matrix").
 */
export function SettingsIntegrationsPane() {
  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Integrations (MCP)</h3>
        <div className="spacer" />
        <button type="button" className="primary-btn" disabled title="Integrations aren't available yet.">
          + Add integration
        </button>
      </div>
      <div className="empty-state">
        MCP integrations (Google Drive, GitHub, Slack, Gmail, etc.) aren't built yet. This tab will list connected
        integrations with their granted scopes and per-agent access once that system lands.
      </div>
    </div>
  );
}
