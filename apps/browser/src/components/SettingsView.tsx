import { useStore, type SettingsTabId } from "../store";
import { PLACEHOLDER_ACCOUNT_EMAIL } from "./Sidebar";
import { SettingsAccountPlanPane } from "./SettingsAccountPlanPane";
import { SettingsConnectionsPane } from "./SettingsConnectionsPane";
import { SettingsGeneralPane } from "./SettingsGeneralPane";
import { SettingsIntegrationsPane } from "./SettingsIntegrationsPane";
import { SettingsPluginsPane } from "./SettingsPluginsPane";
import { SettingsSkillsPane } from "./SettingsSkillsPane";
import { SettingsUsagePane } from "./SettingsUsagePane";

const TABS: { id: SettingsTabId; label: string }[] = [
  { id: "account", label: "Account & Plan" },
  { id: "connections", label: "Connections" },
  { id: "skills", label: "Skills" },
  { id: "plugins", label: "Plugins" },
  { id: "integrations", label: "Integrations" },
  { id: "usage", label: "Usage & Billing" },
  { id: "general", label: "General" },
];

/** Settings shell (spec §3.2/§7): left-tab layout over Account & Plan, Connections, Skills, Plugins,
 * Integrations, Usage & Billing, and General. */
/**
 * No Open Work account gate exists yet on `main` (see NEW-137 follow-up issue) — same placeholder
 * this pane's props default to as `Sidebar`'s `accountEmail` prop, and sign-out is a no-op since
 * there is no real session to end.
 */
export function SettingsView({
  accountEmail = PLACEHOLDER_ACCOUNT_EMAIL,
  idToken,
  onSignOut = () => {},
}: { accountEmail?: string; idToken?: string; onSignOut?: () => void } = {}) {
  const { settingsTab, setSettingsTab } = useStore();

  function renderPane() {
    switch (settingsTab) {
      case "account":
        return <SettingsAccountPlanPane accountEmail={accountEmail} idToken={idToken} onSignOut={onSignOut} />;
      case "connections":
        return <SettingsConnectionsPane />;
      case "skills":
        return <SettingsSkillsPane />;
      case "plugins":
        return <SettingsPluginsPane />;
      case "integrations":
        return <SettingsIntegrationsPane />;
      case "usage":
        return <SettingsUsagePane />;
      case "general":
        return <SettingsGeneralPane />;
      default:
        return null;
    }
  }

  return (
    <div className="main">
      <div className="chat-header">
        <span>Settings</span>
      </div>
      <div className="settings-body">
        <nav className="settings-tab-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`settings-tab-btn${settingsTab === tab.id ? " active" : ""}`}
              onClick={() => setSettingsTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="settings-pane-scroll">{renderPane()}</div>
      </div>
    </div>
  );
}
