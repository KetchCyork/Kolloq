import { requireGoogleUser } from "../googleAuth";
import { getCustomerIdForEmail } from "../kv";
import { createPortalSession } from "../stripeClient";
import { HttpError } from "../types";
import type { Env } from "../types";

export async function handlePortalSession(request: Request, env: Env): Promise<Response> {
  const email = await requireGoogleUser(request, env);

  const customerId = await getCustomerIdForEmail(env, email);
  if (!customerId) {
    throw new HttpError(404, "no_billing_account");
  }

  const body = (await request.json().catch(() => null)) as { returnUrl?: string } | null;
  const session = await createPortalSession(env, customerId, body?.returnUrl || env.DEFAULT_PORTAL_RETURN_URL);

  return Response.json({ url: session.url });
}
