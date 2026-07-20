import { describe, expect, it } from "vitest";
import { buildGoogleAuthorizeUrl, decodeIdToken, verifiedEmailFromClaims } from "./openWorkGoogleAuth";

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
