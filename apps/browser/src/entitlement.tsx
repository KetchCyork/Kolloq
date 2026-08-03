import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { confirmDialog } from "./dialogs";
import { billingApiBase, billingConfigured, fetchEntitlement, type Entitlement, type Plan } from "./billingClient";
import { useStore } from "./store";

/**
 * Real per-plan limits (NEW-234, replacing the Free-only `FREE_LIMITS` placeholder from Phase 3).
 * Structure mirrors the product spec §8.2 table; values there are still marked placeholder pending
 * pricing work, so these will move again — the point of this phase is that they come from *one*
 * place and are actually enforced, not the exact numbers.
 */
export const PLAN_LIMITS: Record<Plan, { agents: number; connections: number; councilSessions: number }> = {
  free: { agents: 2, connections: 2, councilSessions: 1 },
  pro: { agents: 10, connections: Infinity, councilSessions: 25 },
  max: { agents: Infinity, connections: Infinity, councilSessions: Infinity },
};

export type PlanLimits = (typeof PLAN_LIMITS)["free"];

export const PLAN_LABELS: Record<Plan, string> = { free: "Free", pro: "Pro", max: "Max" };

const VALID_PLANS = new Set<Plan>(["free", "pro", "max"]);

/**
 * Pure fail-closed resolver, pulled out of the provider so it's unit-testable without a DOM (this
 * repo's tests exercise plain functions, not rendered React trees — see entitlement.test.ts). A
 * `null` entitlement (never fetched, or every fetch so far failed) and an entitlement whose own
 * `expiresAt` has passed both resolve to Free — never to whatever plan was last seen.
 *
 * `billingFetch` casts the response body to `Entitlement` without runtime validation (NEW-293), so
 * a malformed response can reach here with an `expiresAt` that isn't a finite number (missing,
 * NaN, Infinity) or a `plan` outside the known set. Both fail closed to Free rather than trusting
 * (or crashing on) the bad value — an unbounded `expiresAt` in particular would otherwise grant an
 * entitlement that never expires, and an unrecognized `plan` would throw when `PLAN_LIMITS[plan]`
 * is read downstream.
 */
export function resolveEntitlementState(entitlement: Entitlement | null, nowMs: number): { plan: Plan; status: string } {
  if (entitlement === null) {
    return { plan: "free", status: "active" };
  }
  if (!Number.isFinite(entitlement.expiresAt) || entitlement.expiresAt * 1000 <= nowMs) {
    return { plan: "free", status: "expired" };
  }
  const plan = VALID_PLANS.has(entitlement.plan) ? entitlement.plan : "free";
  return { plan, status: entitlement.status ?? "active" };
}

export type GatedResource = "agents" | "connections" | "councilSessions";

/** True once `currentCount` has reached (or somehow passed) the resource's limit for `limits`. */
export function isAtLimit(resource: GatedResource, currentCount: number, limits: PlanLimits): boolean {
  return currentCount >= limits[resource];
}

interface EntitlementState {
  plan: Plan;
  status: string;
  limits: PlanLimits;
  /** True on the very first fetch only, so callers can avoid flashing a "Free" gate before the real answer arrives. */
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const EntitlementContext = createContext<EntitlementState | null>(null);

/**
 * Fail-closed source of truth for plan gating (spec §8.3: "a tampered client should fail entitlement
 * checks, not unlock features"). `plan` defaults to Free and only becomes something else once a
 * fresh GET /entitlement response — signed server-side by the billing worker — says so. A missing
 * idToken, an unconfigured billing backend, a failed fetch, or a token past its own `expiresAt` all
 * resolve to Free; none of them can fall back to a stale paid plan.
 *
 * Refreshes on mount (session start) and on window focus/visibilitychange — the latter is how the
 * desktop app notices a plan change after the user completes Checkout/Portal in the system browser
 * (see billingClient.ts; there's no in-app redirect to catch instead).
 */
export function EntitlementProvider({ idToken, children }: { idToken: string | undefined; children: ReactNode }) {
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const apiBase = billingApiBase();

  const refresh = useCallback(async () => {
    if (!billingConfigured() || !idToken) {
      setEntitlement(null);
      setError(null);
      setLoading(false);
      return;
    }
    try {
      const result = await fetchEntitlement(apiBase, idToken);
      setEntitlement(result);
      setError(null);
    } catch (err) {
      // A transient failure doesn't clear an entitlement that's still within its own `expiresAt` —
      // but it never invents one either: if the *first* fetch fails, `entitlement` stays null (Free).
      setError(err instanceof Error ? err.message : "entitlement_fetch_failed");
    } finally {
      setLoading(false);
    }
  }, [apiBase, idToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);

  const { plan, status } = resolveEntitlementState(entitlement, Date.now());

  const value = useMemo<EntitlementState>(
    () => ({ plan, status, limits: PLAN_LIMITS[plan], loading, error, refresh }),
    [plan, status, loading, error, refresh],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementState {
  const ctx = useContext(EntitlementContext);
  if (!ctx) throw new Error("useEntitlement must be used within EntitlementProvider");
  return ctx;
}

const RESOURCE_LABEL: Record<GatedResource, string> = {
  agents: "agents",
  connections: "LLM connections",
  councilSessions: "council sessions",
};

/**
 * Blocks creating the next agent/connection/council session once the verified plan's limit is hit
 * (spec §8.2: "hitting a limit... blocks creating the next [thing], with an inline upgrade prompt
 * stating exactly which limit was hit"). Existing items are never affected — this only guards the
 * create actions callers gate explicitly. Returns true when the caller should proceed.
 */
export function useLimitGate() {
  const { plan, limits } = useEntitlement();
  const { setCurrentView, setSettingsTab } = useStore();

  return useCallback(
    async (resource: GatedResource, currentCount: number): Promise<boolean> => {
      if (!isAtLimit(resource, currentCount, limits)) return true;
      const limit = limits[resource];
      const goToPlans = await confirmDialog({
        title: "Plan limit reached",
        message: `You've reached the ${PLAN_LABELS[plan]} plan's limit of ${limit} ${RESOURCE_LABEL[resource]}. Upgrade to add more.`,
        confirmLabel: "View plans",
        cancelLabel: "Not now",
      });
      if (goToPlans) {
        setSettingsTab("account");
        setCurrentView("settings");
      }
      return false;
    },
    [plan, limits, setCurrentView, setSettingsTab],
  );
}
