import { HttpError } from "./types";
import type { Env } from "./types";

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe's form-encoded API needs bracket notation for nested/array params,
// e.g. { line_items: [{ price: "x" }] } -> "line_items[0][price]=x".
function flattenParams(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        if (item && typeof item === "object") {
          pairs.push(...flattenParams(item as Record<string, unknown>, `${paramKey}[${i}]`));
        } else {
          pairs.push([`${paramKey}[${i}]`, String(item)]);
        }
      });
    } else if (typeof value === "object") {
      pairs.push(...flattenParams(value as Record<string, unknown>, paramKey));
    } else {
      pairs.push([paramKey, String(value)]);
    }
  }
  return pairs;
}

/**
 * Board preference: build and verify in Stripe TEST mode first, no live keys until a separate
 * go-live gate (NEW-225 plan §6.4). Refusing anything but a TEST-mode key here means a live key
 * pasted into the secret store too early fails loudly instead of silently taking real payments.
 */
function assertTestModeKey(env: Env): void {
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY)) {
    throw new HttpError(500, "stripe_secret_key_not_test_mode");
  }
}

async function stripeRequest<T>(env: Env, method: "GET" | "POST", path: string, params?: Record<string, unknown>): Promise<T> {
  assertTestModeKey(env);
  const isGet = method === "GET";
  const query = params && isGet ? `?${new URLSearchParams(flattenParams(params)).toString()}` : "";
  const response = await fetch(`${STRIPE_API}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      ...(isGet ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
    },
    body: !isGet && params ? new URLSearchParams(flattenParams(params)).toString() : undefined,
  });
  const body = await response.json<Record<string, unknown>>();
  if (!response.ok) {
    const message = (body.error as { message?: string } | undefined)?.message ?? "stripe_request_failed";
    throw new HttpError(response.status >= 500 ? 502 : 400, message);
  }
  return body as T;
}

export interface StripeCustomer {
  id: string;
  email: string | null;
}

export function retrieveCustomer(env: Env, customerId: string): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(env, "GET", `/customers/${customerId}`);
}

export function createCustomer(env: Env, email: string): Promise<StripeCustomer> {
  return stripeRequest<StripeCustomer>(env, "POST", "/customers", { email, metadata: { openWorkEmail: email } });
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
}

export function createCheckoutSession(
  env: Env,
  params: { customerId: string; priceId: string; successUrl: string; cancelUrl: string; email: string },
): Promise<StripeCheckoutSession> {
  return stripeRequest<StripeCheckoutSession>(env, "POST", "/checkout/sessions", {
    customer: params.customerId,
    mode: "subscription",
    line_items: [{ price: params.priceId, quantity: 1 }],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    client_reference_id: params.email,
  });
}

export interface StripePortalSession {
  id: string;
  url: string;
}

export function createPortalSession(env: Env, customerId: string, returnUrl: string): Promise<StripePortalSession> {
  return stripeRequest<StripePortalSession>(env, "POST", "/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
}
