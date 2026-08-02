import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { verifyGoogleIdToken } from "./googleAuth";
import type { Env } from "./types";

const CLIENT_ID = "test-client-id.apps.googleusercontent.com";
const KID = "test-key-1";
const env = { GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID } as Env;

let privateKey: CryptoKey;

// Stubbed once for the whole file: googleAuth.ts caches the remote JWKS at module scope after the
// first successful fetch, so later tests in this file don't re-fetch anyway.
beforeAll(async () => {
  const { privateKey: priv, publicKey } = await generateKeyPair("RS256");
  privateKey = priv;
  const jwk = await exportJWK(publicKey);

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      if (String(input) === "https://www.googleapis.com/oauth2/v3/certs") {
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }), {
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch in test: ${input}`);
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function signIdToken(claims: Record<string, unknown>) {
  return new SignJWT({ email: "user@example.com", email_verified: true, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer("https://accounts.google.com")
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
}

describe("verifyGoogleIdToken", () => {
  it("returns the lowercased, verified email for a valid token", async () => {
    const token = await signIdToken({ email: "User@Example.com" });
    await expect(verifyGoogleIdToken(token, env)).resolves.toBe("user@example.com");
  });

  it("rejects a token for a different audience", async () => {
    const wrongAudience = await new SignJWT({ email: "user@example.com", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer("https://accounts.google.com")
      .setAudience("someone-elses-client-id")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    await expect(verifyGoogleIdToken(wrongAudience, env)).rejects.toThrow();
  });

  it("rejects a token whose email Google hasn't verified", async () => {
    const token = await signIdToken({ email_verified: false });
    await expect(verifyGoogleIdToken(token, env)).rejects.toThrow();
  });
});
