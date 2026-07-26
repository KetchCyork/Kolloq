import { ENTITLEMENT_TOKEN_TTL_SECONDS } from "../config";
import { signEntitlementToken } from "../entitlementToken";
import { requireGoogleUser } from "../googleAuth";
import { getCustomerIdForEmail, getCustomerRecord } from "../kv";
import type { Env } from "../types";

export async function handleEntitlement(request: Request, env: Env): Promise<Response> {
  const email = await requireGoogleUser(request, env);

  const customerId = await getCustomerIdForEmail(env, email);
  const record = customerId ? await getCustomerRecord(env, customerId) : null;

  const plan = record?.plan ?? "free";
  const status = record?.status ?? "active";
  const token = await signEntitlementToken({ email, plan, status }, env);

  return Response.json({
    token,
    plan,
    status,
    currentPeriodEnd: record?.currentPeriodEnd ?? null,
    expiresAt: Math.floor(Date.now() / 1000) + ENTITLEMENT_TOKEN_TTL_SECONDS,
  });
}
