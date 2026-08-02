import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStripeSignature } from "./webhookSignature.js";

const SECRET = "whsec_test_secret";
const NOW = 1_800_000_000;

function sign(body: string, timestamp: number, secret = SECRET): string {
  const hex = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${hex}`;
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed payload within the tolerance window", () => {
    const body = JSON.stringify({ type: "invoice.paid" });
    const header = sign(body, NOW);
    expect(verifyStripeSignature(body, header, SECRET, NOW)).toBe(true);
  });

  it("rejects a missing signature header", () => {
    expect(verifyStripeSignature("{}", null, SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature("{}", undefined, SECRET, NOW)).toBe(false);
  });

  it("rejects a signature produced with the wrong secret", () => {
    const body = "{}";
    const header = sign(body, NOW, "wrong_secret");
    expect(verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a tampered body", () => {
    const header = sign(JSON.stringify({ type: "invoice.paid" }), NOW);
    expect(verifyStripeSignature(JSON.stringify({ type: "invoice.payment_failed" }), header, SECRET, NOW)).toBe(false);
  });

  it("rejects a timestamp outside the replay tolerance window", () => {
    const body = "{}";
    const header = sign(body, NOW - 10 * 60);
    expect(verifyStripeSignature(body, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a malformed header", () => {
    expect(verifyStripeSignature("{}", "not-a-valid-header", SECRET, NOW)).toBe(false);
    expect(verifyStripeSignature("{}", `t=${NOW}`, SECRET, NOW)).toBe(false);
  });
});
