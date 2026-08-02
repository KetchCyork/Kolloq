import { createRemoteJWKSet, jwtVerify } from "jose";
import { HttpError } from "./types";
import type { Env } from "./types";

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// Module-level cache: jose dedupes concurrent fetches and re-fetches on key-not-found, so one
// remote set can be reused across requests to the same isolate.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function googleJwks() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return jwks;
}

/**
 * Verifies a Google OIDC id_token (signature, issuer, audience, expiry) and returns the
 * verified, lowercased email. This is the auth contract Phase 3 (frontend wiring) uses to call
 * every endpoint below: `Authorization: Bearer <google id_token>`.
 */
export async function verifyGoogleIdToken(idToken: string, env: Env): Promise<string> {
  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, googleJwks(), {
      issuer: GOOGLE_ISSUERS,
      audience: env.GOOGLE_OAUTH_CLIENT_ID,
    }));
  } catch {
    throw new HttpError(401, "invalid_id_token");
  }
  if (payload.email_verified !== true || typeof payload.email !== "string") {
    throw new HttpError(401, "email_not_verified");
  }
  return payload.email.toLowerCase();
}

export async function requireGoogleUser(request: Request, env: Env): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) throw new HttpError(401, "missing_bearer_token");
  return verifyGoogleIdToken(match[1], env);
}
