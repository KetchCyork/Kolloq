import { useStore } from "../store";

/**
 * Tier data is a placeholder (spec §8.2: "Limits below are placeholders — final numbers TBD pending
 * pricing work"). Real Kolloq accounts only have a Free tier for now (no billing backend exists
 * yet — see openWorkAccount.ts) so every account is shown against Free's limits; the comparison grid
 * below is illustrative, not something a user can actually act on yet.
 */
const FREE_LIMITS = { agents: 2, connections: 2, councilSessions: 1 };

const TIERS = [
  {
    name: "Free",
    price: "$0",
    features: ["2 agents", "1 active project", "1 council/mo, 3 seats", "2 LLM connections"],
    current: true,
  },
  {
    name: "Pro",
    price: "$20",
    period: "/mo",
    features: ["10 agents", "10 projects", "25 councils/mo, 5 seats", "Unlimited connections", "Scheduled tasks"],
    current: false,
  },
  {
    name: "Max",
    price: "$60",
    period: "/mo",
    features: ["Unlimited agents", "Unlimited projects", "Unlimited councils", "Priority support"],
    current: false,
  },
  {
    name: "Enterprise",
    price: "Custom",
    features: ["SAML/OIDC single sign-on", "Your logo & colors", "Admin console & audit log", "Org-managed API keys"],
    current: false,
  },
];

function limitRow(label: string, used: number, limit: number) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="settings-limit-row" key={label}>
      <div className="settings-limit-row-top">
        <span>{label}</span>
        <b>
          {used} of {limit}
        </b>
      </div>
      <div className="meter">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function SettingsAccountPlanPane({ accountEmail, onSignOut }: { accountEmail: string; onSignOut: () => void }) {
  const { sessions, accounts, councilSessions } = useStore();

  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Account &amp; Plan</h3>
        <div className="spacer" />
        <button type="button" className="settings-btn" disabled title="Billing isn't available yet — no billing backend exists.">
          Billing portal
        </button>
        <button type="button" className="settings-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="settings-card">
        <div className="settings-card-row">
          <div>
            <h3>
              {accountEmail} <span className="badge">FREE</span>
            </h3>
            <div className="settings-card-sub">Kolloq account</div>
          </div>
          <div className="spacer" />
          <button type="button" className="settings-btn" disabled title="Billing isn't available yet.">
            Upgrade to Pro
          </button>
        </div>
        <div style={{ marginTop: 16 }}>
          {limitRow("Agents", sessions.length, FREE_LIMITS.agents)}
          {limitRow("LLM connections", accounts.length, FREE_LIMITS.connections)}
          {limitRow("Council sessions", councilSessions.length, FREE_LIMITS.councilSessions)}
        </div>
        <div className="settings-note">
          Counts above are your real totals; monthly reset and enforcement aren't wired up yet, so hitting a number
          shown here doesn't block anything.
        </div>
      </div>

      <h3>Plans</h3>
      <div className="settings-tier-grid">
        {TIERS.map((tier) => (
          <div className={`settings-tier${tier.current ? " current" : ""}`} key={tier.name}>
            <h4>{tier.name}</h4>
            <div className="settings-tier-price">
              {tier.price}
              {tier.period && <small>{tier.period}</small>}
            </div>
            <ul>
              {tier.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            <button type="button" className="settings-btn" disabled title="Billing isn't available yet.">
              {tier.current ? "Current plan" : tier.name === "Enterprise" ? "Contact sales" : "Upgrade"}
            </button>
          </div>
        ))}
      </div>
      <div className="settings-note">
        Tier limits shown are placeholders pending pricing research (spec §8.2) — there is no billing backend yet,
        so plan changes aren't available.
      </div>
    </div>
  );
}
