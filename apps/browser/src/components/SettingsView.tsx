import { useStore } from "../store";

/**
 * Settings shell (spec §3.2: Account & Plan, Connections, Skills, Plugins, Integrations, General,
 * Usage & Billing). Full tabbed content is a follow-up child issue — this bridges to the existing
 * Accounts/Preferences modals until those tabs land here directly.
 */
export function SettingsView() {
  const { openAccountsManager, openPreferences, accounts } = useStore();

  return (
    <div className="main">
      <div className="chat-header">
        <span>Settings</span>
      </div>
      <div className="empty-state" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p>More Settings tabs (Connections, Skills, Plugins, Usage &amp; Billing) are coming soon.</p>
        <button className="sidebar-new-btn" onClick={openAccountsManager}>
          Manage provider accounts ({accounts.length})
        </button>
        <button className="sidebar-new-btn" onClick={openPreferences}>
          General &amp; account preferences
        </button>
      </div>
    </div>
  );
}
