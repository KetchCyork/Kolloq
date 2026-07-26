import { handleCreateCheckoutSession } from "./handlers/createCheckoutSession";
import { handleEntitlement } from "./handlers/entitlement";
import { handlePortalSession } from "./handlers/portalSession";
import { handleStripeWebhook } from "./handlers/stripeWebhook";
import { HttpError } from "./types";
import type { Env } from "./types";

// Wildcard CORS is safe here: every route (besides the Stripe webhook, which Stripe calls
// server-to-server) is authorized by a bearer Google id_token that only the legitimate signed-in
// user holds, not by cookies/ambient browser credentials — so a third-party origin reading the
// response can't do anything a stolen token wouldn't already allow.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);
    try {
      let response: Response;
      if (request.method === "POST" && url.pathname === "/create-checkout-session") {
        response = await handleCreateCheckoutSession(request, env);
      } else if (request.method === "POST" && url.pathname === "/stripe-webhook") {
        response = await handleStripeWebhook(request, env);
      } else if (request.method === "GET" && url.pathname === "/entitlement") {
        response = await handleEntitlement(request, env);
      } else if (request.method === "POST" && url.pathname === "/portal-session") {
        response = await handlePortalSession(request, env);
      } else {
        response = Response.json({ error: "not_found" }, { status: 404 });
      }
      return withCors(response);
    } catch (error) {
      if (error instanceof HttpError) {
        return withCors(Response.json({ error: error.message }, { status: error.status }));
      }
      console.error("billing-worker unhandled error", error);
      return withCors(Response.json({ error: "internal_error" }, { status: 500 }));
    }
  },
};
