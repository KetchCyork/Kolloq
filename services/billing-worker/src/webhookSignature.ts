import { WEBHOOK_TOLERANCE_SECONDS } from "./config";

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifies a Stripe `Stripe-Signature` header per Stripe's documented scheme:
 * HMAC-SHA256 over `${timestamp}.${rawBody}`, compared against the `v1` value(s), with the
 * timestamp checked against replay beyond a tolerance window. `rawBody` must be the exact bytes
 * Stripe sent — never a re-serialized/re-parsed JSON string.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<boolean> {
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

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = toHex(signed);

  return candidates.some((candidate) => timingSafeEqual(candidate, expected));
}
