import { useCallback, useEffect, useState } from "react";
import {
  BillingApiError,
  billingApiBase,
  billingConfigured,
  createCheckoutSession,
  createPortalSession,
  fetchEntitlement,
  type Entitlement,
  type Plan,
} from "../billingClient";
import { openExternalUrl } from "../credentials";
import { useStore } from "../store";

/**
 * Tier data is a placeholder (spec §8.2: "Limits below are placeholders — final numbers TBD pending
 * pricing work"). `FREE_LIMITS` is shown for every account regardless of plan — turning it into real
 * per-plan, server-verified limits is Phase 4 (NEW-234). This pane only owns getting the account onto
 * the right *plan*, via Stripe Checkout/Portal (Phase 3, NEW-233); it never trusts client state for
 * that — `plan`/`status` always come from a fresh GET /entitlement call.
 */
const FREE_LIMITS = { agents: 2, connections: 2, councilSessions: 1 };

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

  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [entitlementError, setEntitlementError] = useState<string | null>(null);
  const [checkoutBusyPlan, setCheckoutBusyPlan] = useState<Plan | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refreshEntitlement = useCallback(async () => {
    if (!billingReady || !idToken) return;
    try {
      const result = await fetchEntitlement(apiBase, idToken);
      setEntitlement(result);
      setEntitlementError(null);
    } catch (err) {
      setEntitlementError(describeBillingError(err, "Couldn't load your plan."));
    }
  }, [billingReady, apiBase, idToken]);

  useEffect(() => {
    void refreshEntitlement();
  }, [refreshEntitlement]);

  // The desktop app opens Checkout/the Portal in the system browser (openExternalUrl) — its own
  // window never navigates to the Stripe return URL, so there's no redirect to capture. Re-checking
  // on focus is how the app notices a plan change after the user comes back from the browser.
  useEffect(() => {
    if (!billingReady) return;
    function onFocus() {
      void refreshEntitlement();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [billingReady, refreshEntitlement]);

  const currentPlan: Plan = entitlement?.plan ?? "free";
  const currentStatus = entitlement?.status ?? "active";

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
            <div className="settings-card-sub">Open Work account</div>
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
          {limitRow("Agents", sessions.length, FREE_LIMITS.agents)}
          {limitRow("LLM connections", accounts.length, FREE_LIMITS.connections)}
          {limitRow("Council sessions", councilSessions.length, FREE_LIMITS.councilSessions)}
        </div>
        <div className="settings-note">
          {currentPlan === "free"
            ? "Counts above are your real totals; monthly reset and enforcement aren't wired up yet, so hitting a number shown here doesn't block anything."
            : `Counts above still show Free's limits — per-plan usage limits for ${currentPlan.toUpperCase()} aren't wired up yet (that's Phase 4), so hitting a number shown here doesn't block anything.`}
        </div>
        {entitlementError && <div className="settings-note">Couldn't confirm your plan: {entitlementError}</div>}
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
