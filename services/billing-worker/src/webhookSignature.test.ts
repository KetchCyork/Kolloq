import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./webhookSignature";

const SECRET = "whsec_test_secret";

async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(signed)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed header", async () => {
    const body = JSON.stringify({ type: "customer.subscription.created" });
    const now = 1_800_000_000;
    const header = await sign(SECRET, now, body);
    expect(await verifyStripeSignature(body, header, SECRET, now)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = "{}";
    const now = 1_800_000_000;
    const header = await sign("wrong_secret", now, body);
    expect(await verifyStripeSignature(body, header, SECRET, now)).toBe(false);
  });

  it("rejects a tampered body", async () => {
    const now = 1_800_000_000;
    const header = await sign(SECRET, now, "{\"amount\":100}");
    expect(await verifyStripeSignature("{\"amount\":100000}", header, SECRET, now)).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", async () => {
    const body = "{}";
    const signedAt = 1_800_000_000;
    const header = await sign(SECRET, signedAt, body);
    expect(await verifyStripeSignature(body, header, SECRET, signedAt + 10 * 60)).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect(await verifyStripeSignature("{}", null, SECRET)).toBe(false);
  });

  it("rejects a malformed header", async () => {
    expect(await verifyStripeSignature("{}", "not-a-valid-header", SECRET)).toBe(false);
  });
});
