import { useState } from "react";
import { BillingApiError, billingApiBase, billingConfigured, createCheckoutSession, createPortalSession, type Plan } from "../billingClient";
import { openExternalUrl } from "../credentials";
import { useEntitlement } from "../entitlement";
import { useStore } from "../store";

/**
 * Tier feature copy is a placeholder (spec §8.2: "Limits below are placeholders — final numbers TBD
 * pending pricing work"). The *limits* enforced below, though, are real — they come from
 * `useEntitlement()` (NEW-234), which is fed only by a fresh, signed GET /entitlement response
 * (NEW-232/233). This pane never trusts client state for the current plan or its limits.
 */

// Must match services/billing-worker/src/config.ts's PRICE_PLAN (Stripe TEST mode, NEW-231's
// products) — Price IDs are public catalog data, not secrets, so committing them here is fine.
const PRO_MONTHLY_PRICE_ID = "price_1TxWR3GgrGbDWiCh6h4mm1mX";
const MAX_MONTHLY_PRICE_ID = "price_1TxWR4GgrGbDWiChDelYk2LV";

interface Tier {
  name: string;
  plan: Plan | "enterprise";
  price: string;
  period?: string;
  features: string[];
  priceId?: string;
}

const TIERS: Tier[] = [
  { name: "Free", plan: "free", price: "$0", features: ["2 agents", "1 active project", "1 council/mo, 3 seats", "2 LLM connections"] },
  {
    name: "Pro",
    plan: "pro",
    price: "$20",
    period: "/mo",
    features: ["10 agents", "10 projects", "25 councils/mo, 5 seats", "Unlimited connections", "Scheduled tasks"],
    priceId: PRO_MONTHLY_PRICE_ID,
  },
  {
    name: "Max",
    plan: "max",
    price: "$60",
    period: "/mo",
    features: ["Unlimited agents", "Unlimited projects", "Unlimited councils", "Priority support"],
    priceId: MAX_MONTHLY_PRICE_ID,
  },
  {
    name: "Enterprise",
    plan: "enterprise",
    price: "Custom",
    features: ["SAML/OIDC single sign-on", "Your logo & colors", "Admin console & audit log", "Org-managed API keys"],
  },
];

function limitRow(label: string, used: number, limit: number) {
  const unlimited = !Number.isFinite(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="settings-limit-row" key={label}>
      <div className="settings-limit-row-top">
        <span>{label}</span>
        <b>{unlimited ? `${used} (unlimited)` : `${used} of ${limit}`}</b>
      </div>
      <div className="meter">
        <div style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function planBadgeClass(plan: Plan, status: string): string {
  if (plan === "free") return "badge gray";
  if (status !== "active" && status !== "trialing") return "badge amber";
  return "badge green";
}

/** Human-readable reason billing actions are disabled, or undefined if they're available. */
function billingUnavailableReason(idToken: string | undefined): string | undefined {
  if (!billingConfigured()) return "Billing isn't set up yet — no billing backend is configured.";
  if (!idToken) return "Sign in with Google to manage billing.";
  return undefined;
}

/** Turns a failed billing call into something a user can act on. */
function describeBillingError(err: unknown, fallback: string): string {
  if (err instanceof BillingApiError) {
    if (err.status === 404 && err.message === "no_billing_account") {
      return "You don't have a billing account yet — upgrade to a paid plan first.";
    }
    return `${fallback} (${err.message})`;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function SettingsAccountPlanPane({
  accountEmail,
  idToken,
  onSignOut,
}: {
  accountEmail: string;
  idToken?: string;
  onSignOut: () => void;
}) {
  const { sessions, accounts, councilSessions } = useStore();
  const apiBase = billingApiBase();
  const billingReady = billingConfigured() && Boolean(idToken);
  const disabledReason = billingUnavailableReason(idToken);

  // Entitlement fetching, focus-refresh, and fail-closed-to-Free logic all live in one shared
  // provider (entitlement.tsx) so the same verified plan/limits gate creation actions elsewhere in
  // the app (Sidebar, AgentsView, SettingsConnectionsPane), not just this pane's display.
  const { plan: currentPlan, status: currentStatus, limits, error: entitlementError } = useEntitlement();

  const [checkoutBusyPlan, setCheckoutBusyPlan] = useState<Plan | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleUpgrade(tier: Tier) {
    if (!billingReady || !idToken || !tier.priceId) return;
    setActionError(null);
    setCheckoutBusyPlan(tier.plan as Plan);
    try {
      const session = await createCheckoutSession(apiBase, idToken, tier.priceId);
      await openExternalUrl(session.url);
    } catch (err) {
      setActionError(describeBillingError(err, "Couldn't start checkout."));
    } finally {
      setCheckoutBusyPlan(null);
    }
  }

  async function handlePortal() {
    if (!billingReady || !idToken) return;
    setActionError(null);
    setPortalBusy(true);
    try {
      const session = await createPortalSession(apiBase, idToken);
      await openExternalUrl(session.url);
    } catch (err) {
      setActionError(describeBillingError(err, "Couldn't open the billing portal."));
    } finally {
      setPortalBusy(false);
    }
  }

  function tierButton(tier: Tier) {
    if (tier.plan === currentPlan) {
      return (
        <button type="button" className="settings-btn" disabled>
          Current plan
        </button>
      );
    }
    if (tier.plan === "enterprise") {
      return (
        <button type="button" className="settings-btn" disabled title="Enterprise billing isn't self-serve yet.">
          Contact sales
        </button>
      );
    }
    // A signed-up customer already has a subscription — Checkout would start a second one, so plan
    // changes for them go through the Portal's built-in "switch plan" flow instead.
    if (currentPlan !== "free") {
      return (
        <button type="button" className="settings-btn" disabled={!billingReady || portalBusy} title={disabledReason} onClick={() => void handlePortal()}>
          {portalBusy ? "Opening…" : "Change plan"}
        </button>
      );
    }
    const busy = checkoutBusyPlan === tier.plan;
    return (
      <button
        type="button"
        className="settings-btn"
        disabled={!billingReady || checkoutBusyPlan !== null}
        title={disabledReason}
        onClick={() => void handleUpgrade(tier)}
      >
        {busy ? "Redirecting…" : "Upgrade"}
      </button>
    );
  }

  const nextTier = currentPlan === "free" ? TIERS.find((t) => t.plan === "pro") : undefined;

  return (
    <div className="settings-pane-inner">
      <div className="settings-pane-header">
        <h3>Account &amp; Plan</h3>
        <div className="spacer" />
        <button
          type="button"
          className="settings-btn"
          disabled={!billingReady || portalBusy}
          title={disabledReason}
          onClick={() => void handlePortal()}
        >
          {portalBusy ? "Opening…" : "Billing portal"}
        </button>
        <button type="button" className="settings-btn" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      {actionError && <div className="settings-note">{actionError}</div>}

      <div className="settings-card">
        <div className="settings-card-row">
          <div>
            <h3>
              {accountEmail} <span className={planBadgeClass(currentPlan, currentStatus)}>{currentPlan.toUpperCase()}</span>
            </h3>
            <div className="settings-card-sub">Kolloq account</div>
          </div>
          <div className="spacer" />
          {nextTier && (
            <button
              type="button"
              className="settings-btn"
              disabled={!billingReady || checkoutBusyPlan !== null}
              title={disabledReason}
              onClick={() => void handleUpgrade(nextTier)}
            >
              {checkoutBusyPlan === nextTier.plan ? "Redirecting…" : `Upgrade to ${nextTier.name}`}
            </button>
          )}
        </div>
        <div style={{ marginTop: 16 }}>
          {limitRow("Agents", sessions.length, limits.agents)}
          {limitRow("LLM connections", accounts.length, limits.connections)}
          {limitRow("Council sessions", councilSessions.length, limits.councilSessions)}
        </div>
        <div className="settings-note">
          Counts above are your real totals against your {currentPlan.toUpperCase()} plan's limits — creating past a limit is blocked with an
          upgrade prompt. Monthly reset for council sessions isn't wired up yet, so the count here is lifetime, not per-month.
        </div>
        {entitlementError && (
          <div className="settings-note">Couldn't confirm your plan, showing Free limits until it's reachable again: {entitlementError}</div>
        )}
      </div>

      <h3>Plans</h3>
      <div className="settings-tier-grid">
        {TIERS.map((tier) => (
          <div className={`settings-tier${tier.plan === currentPlan ? " current" : ""}`} key={tier.name}>
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
            {tierButton(tier)}
          </div>
        ))}
      </div>
      <div className="settings-note">
        {billingReady
          ? "Tier limits shown are placeholders pending pricing research (spec §8.2). Prices are Stripe TEST mode — no real charge happens yet."
          : `Tier limits shown are placeholders pending pricing research (spec §8.2). ${disabledReason ?? ""}`}
      </div>
    </div>
  );
}
