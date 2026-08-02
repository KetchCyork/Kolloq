import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe tolerates signature timestamps within this window to reject replayed webhook deliveries. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/**
 * Verifies a Stripe `Stripe-Signature` header per Stripe's documented scheme:
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, compared against the `v1` value(s), with the
 * timestamp checked against replay beyond a tolerance window. `rawBody` must be the exact bytes
 * Stripe sent — never a re-serialized/re-parsed JSON string.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | undefined | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader) return false;

  const parts = new Map<string, string[]>();
  for (const item of signatureHeader.split(",")) {
    const [key, value] = item.split("=", 2);
    if (!key || value === undefined) continue;
    const list = parts.get(key) ?? [];
    list.push(value);
    parts.set(key, list);
  }

  const timestamp = parts.get("t")?.[0];
  const candidates = parts.get("v1") ?? [];
  if (!timestamp || candidates.length === 0) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");

  return candidates.some((candidate) => {
    const candidateBuf = Buffer.from(candidate, "utf8");
    return candidateBuf.length === expectedBuf.length && timingSafeEqual(candidateBuf, expectedBuf);
  });
}
