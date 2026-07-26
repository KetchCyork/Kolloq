/**
 * Client for the billing worker (services/billing-worker, NEW-232 Phase 2). Every route it calls is
 * authorized by `Authorization: Bearer <Google id_token>` — the same id_token
 * openWorkGoogleAuth.ts's runGoogleSignIn already gets from Google Sign-In, carried on
 * `AppSession.idToken`. There is no separate Open Work account backend, so billing only works for a
 * real Google-signed-in session (see openWorkAccount.ts).
 *
 * `base` (the worker's deployed URL) is threaded through as an explicit argument rather than read
 * from `import.meta.env` inside each call: Vite inlines `import.meta.env` at transform time, so
 * `vi.stubEnv` can't reach it in tests (same constraint documented in openWorkGoogleAuth.ts). Callers
 * read the env once via `billingApiBase()`.
 */
function env(name: string): string {
  const value = (import.meta as { env?: Record<string, string | undefined> }).env?.[name];
  return (value ?? "").trim();
}

/** Strips a trailing slash so callers can concatenate `${base}/path` directly. Exported for testing. */
export function normalizeApiBase(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

/** Base URL of the deployed billing worker (e.g. `https://newvector-billing-worker.<subdomain>.workers.dev`). */
export function billingApiBase(): string {
  return normalizeApiBase(env("VITE_BILLING_API_URL"));
}

/** True once a billing worker URL is configured. Until then billing UI stays disabled. */
export function billingConfigured(): boolean {
  return billingApiBase().length > 0;
}

export type CheckoutReturnStatus = "success" | "cancelled" | "portal";

/** Public landing page the worker itself serves for Stripe to redirect the system browser back to. */
export function checkoutReturnUrl(base: string, status: CheckoutReturnStatus): string {
  return `${base}/checkout/return?status=${status}`;
}

export class BillingApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function billingFetch<T>(base: string, path: string, idToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BillingApiError((body as { error?: string }).error ?? `billing_request_failed_${response.status}`, response.status);
  }
  return body as T;
}

export interface CheckoutSession {
  url: string;
  id: string;
}

export function createCheckoutSession(base: string, idToken: string, priceId: string): Promise<CheckoutSession> {
  return billingFetch<CheckoutSession>(base, "/create-checkout-session", idToken, {
    method: "POST",
    body: JSON.stringify({
      priceId,
      successUrl: checkoutReturnUrl(base, "success"),
      cancelUrl: checkoutReturnUrl(base, "cancelled"),
    }),
  });
}

export interface PortalSession {
  url: string;
}

export function createPortalSession(base: string, idToken: string): Promise<PortalSession> {
  return billingFetch<PortalSession>(base, "/portal-session", idToken, {
    method: "POST",
    body: JSON.stringify({ returnUrl: checkoutReturnUrl(base, "portal") }),
  });
}

export type Plan = "free" | "pro" | "max";

export interface Entitlement {
  token: string;
  plan: Plan;
  status: string;
  currentPeriodEnd: number | null;
  expiresAt: number;
}

export function fetchEntitlement(base: string, idToken: string): Promise<Entitlement> {
  return billingFetch<Entitlement>(base, "/entitlement", idToken, { method: "GET" });
}
