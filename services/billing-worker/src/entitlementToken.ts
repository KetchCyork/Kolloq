import { SignJWT, jwtVerify } from "jose";
import { ENTITLEMENT_TOKEN_TTL_SECONDS } from "./config";
import type { Plan } from "./config";
import type { Env } from "./types";

export interface EntitlementClaims {
  email: string;
  plan: Plan;
  status: string;
}

function signingKey(env: Env): Uint8Array {
  return new TextEncoder().encode(env.ENTITLEMENT_SIGNING_SECRET);
}

/** Short-lived signed token (product spec §8.3) — the client re-verifies via GET /entitlement. */
export async function signEntitlementToken(claims: EntitlementClaims, env: Env): Promise<string> {
  return new SignJWT({ plan: claims.plan, status: claims.status })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.email)
    .setIssuer("newvector-billing-worker")
    .setIssuedAt()
    .setExpirationTime(`${ENTITLEMENT_TOKEN_TTL_SECONDS}s`)
    .sign(signingKey(env));
}

/** For future gated endpoints to verify a client-presented entitlement token server-side. */
export async function verifyEntitlementToken(token: string, env: Env): Promise<EntitlementClaims> {
  const { payload } = await jwtVerify(token, signingKey(env), {
    issuer: "newvector-billing-worker",
  });
  return {
    email: String(payload.sub),
    plan: payload.plan as Plan,
    status: String(payload.status),
  };
}
