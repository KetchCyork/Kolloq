/**
 * Scaffold only — there's no aggregated spend tracking yet (spec §7: "per-connection and per-agent
 * token/cost dashboards, per-month; budget alerts; Council sessions itemized"). Per-turn cost notes
 * already exist inside each Council session's transcript (client-side estimates, not metered
 * provider usage) but nothing rolls them up across sessions/agents/months yet.
 */
export function SettingsUsagePane() {
  return (
    <div className="settings-pane-inner">
      <h3>Usage &amp; Billing</h3>
      <div className="empty-state">
        Usage dashboards (spend by connection/agent, budget alerts, itemized Council costs) aren't built yet. Each
        Council session already shows a client-side cost estimate per turn in its own transcript — this tab will
        roll those up once aggregated tracking lands.
      </div>
    </div>
  );
}
