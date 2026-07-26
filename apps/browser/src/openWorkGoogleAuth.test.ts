import { describe, expect, it } from "vitest";
import {
  buildGoogleAuthorizeUrl,
  credentialsComplete,
  decodeIdToken,
  googleClientId,
  googleClientSecret,
  googleSignInConfigured,
  googleTokenErrorMessage,
  verifiedEmailFromClaims,
} from "./openWorkGoogleAuth";

/** Builds an unsigned JWT (header.payload.signature) for decode/verify tests. */
function makeIdToken(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature`;
}

const CLIENT_ID = "123-abc.apps.googleusercontent.com";
const NONCE = "nonce-value";
const FUTURE = Math.floor(Date.now() / 1000) + 3600;

describe("buildGoogleAuthorizeUrl", () => {
  it("targets Google's consent endpoint with PKCE + loopback redirect", () => {
    const url = new URL(buildGoogleAuthorizeUrl({ clientId: CLIENT_ID, challenge: "chal", state: "st", nonce: NONCE }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("nonce")).toBe(NONCE);
    expect(url.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:8765");
    expect(url.searchParams.get("scope")).toContain("email");
  });
});

describe("decodeIdToken", () => {
  it("reads the JWT payload", () => {
    const token = makeIdToken({ email: "a@b.com", sub: "42" });
    expect(decodeIdToken(token)).toMatchObject({ email: "a@b.com", sub: "42" });
  });

  it("rejects a malformed token", () => {
    expect(() => decodeIdToken("not-a-jwt")).toThrow(/malformed/i);
  });
});

describe("verifiedEmailFromClaims", () => {
  const base = { iss: "https://accounts.google.com", aud: CLIENT_ID, nonce: NONCE, exp: FUTURE, email: "person@gmail.com", email_verified: true };

  it("returns the email when every claim checks out", () => {
    expect(verifiedEmailFromClaims(base, { clientId: CLIENT_ID, nonce: NONCE })).toBe("person@gmail.com");
  });

  it("rejects a wrong audience (token minted for a different app)", () => {
    expect(() => verifiedEmailFromClaims({ ...base, aud: "other" }, { clientId: CLIENT_ID, nonce: NONCE })).toThrow(/audience/i);
  });

  it("rejects a nonce mismatch (replay/tamper)", () => {
    expect(() => verifiedEmailFromClaims({ ...base, nonce: "stale" }, { clientId: CLIENT_ID, nonce: NONCE })).toThrow(/nonce/i);
  });

  it("rejects a non-Google issuer", () => {
    expect(() => verifiedEmailFromClaims({ ...base, iss: "https://evil.example" }, { clientId: CLIENT_ID, nonce: NONCE })).toThrow(/issuer/i);
  });

  it("rejects an expired token", () => {
    expect(() => verifiedEmailFromClaims({ ...base, exp: 1 }, { clientId: CLIENT_ID, nonce: NONCE })).toThrow(/expired/i);
  });

  it("rejects an unverified email", () => {
    expect(() => verifiedEmailFromClaims({ ...base, email_verified: false }, { clientId: CLIENT_ID, nonce: NONCE })).toThrow(/not verified/i);
  });
});

describe("credential configuration", () => {
  // These drive the pure predicate rather than the ambient env: the real secret lives in an
  // untracked apps/browser/.env on a configured machine, and Vite inlines `import.meta.env` at
  // transform time (so `vi.stubEnv` cannot reach it). Asserting on the loaded value would flip the
  // result per-machine and print the secret into test output on failure.
  it("ships a real Client ID so no per-machine setup is needed for the public half", () => {
    expect(googleClientId()).toMatch(/\.apps\.googleusercontent\.com$/);
  });

  it("treats a Client ID alone as not configured — the secret is what gates the button", () => {
    // Google rejects the token exchange without client_secret, so a Client ID alone must NOT light
    // up the button — otherwise the user logs in at Google and only then hits a dead end.
    expect(credentialsComplete(googleClientId(), "")).toBe(false);
    expect(credentialsComplete(googleClientId(), "   ")).toBe(false);
  });

  it("becomes configured once the Client Secret is supplied at build time", () => {
    expect(credentialsComplete(googleClientId(), "GOCSPX-test-value")).toBe(true);
  });

  it("agrees with the env-backed check on this machine", () => {
    expect(googleSignInConfigured()).toBe(credentialsComplete(googleClientId(), googleClientSecret()));
  });
});

describe("googleTokenErrorMessage", () => {
  it("surfaces Google's description of the misconfiguration", () => {
    expect(googleTokenErrorMessage(400, { error: "invalid_request", error_description: "client_secret is missing." })).toContain(
      "client_secret is missing.",
    );
  });

  it("falls back to the error code, then to the status", () => {
    expect(googleTokenErrorMessage(401, { error: "invalid_client" })).toContain("invalid_client");
    expect(googleTokenErrorMessage(500, {})).toContain("500");
  });

  it("explains a 200 that carried no id_token", () => {
    expect(googleTokenErrorMessage(200, {})).toMatch(/no id_token/i);
  });
});
