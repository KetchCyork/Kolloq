import { describe, expect, it } from "vitest";
import type { Entitlement } from "./billingClient";
import { isAtLimit, PLAN_LIMITS, resolveEntitlementState } from "./entitlement";

function entitlement(overrides: Partial<Entitlement> = {}): Entitlement {
  return { plan: "pro", status: "active", currentPeriodEnd: null, expiresAt: 2_000, ...overrides };
}

describe("resolveEntitlementState", () => {
  it("fails closed to Free when no entitlement has ever been fetched", () => {
    expect(resolveEntitlementState(null, 1_000_000)).toEqual({ plan: "free", status: "active" });
  });

  it("trusts an unexpired entitlement's plan and status", () => {
    const nowMs = 1_500_000;
    const result = resolveEntitlementState(entitlement({ plan: "max", status: "trialing", expiresAt: 2_000 }), nowMs);
    expect(result).toEqual({ plan: "max", status: "trialing" });
  });

  it("fails closed to Free once expiresAt has passed, even for a paid plan", () => {
    const expiresAtMs = 2_000 * 1000;
    const result = resolveEntitlementState(entitlement({ plan: "max", expiresAt: 2_000 }), expiresAtMs);
    expect(result).toEqual({ plan: "free", status: "expired" });
  });

  it("treats a token expiring exactly now as expired (boundary is inclusive)", () => {
    const result = resolveEntitlementState(entitlement({ expiresAt: 100 }), 100_000);
    expect(result.plan).toBe("free");
    expect(result.status).toBe("expired");
  });

  it("stays on the paid plan one millisecond before expiry", () => {
    const result = resolveEntitlementState(entitlement({ plan: "pro", expiresAt: 100 }), 99_999);
    expect(result).toEqual({ plan: "pro", status: "active" });
  });

  it("fails closed to Free when expiresAt is NaN", () => {
    const result = resolveEntitlementState(entitlement({ plan: "max", expiresAt: NaN }), 1_000_000);
    expect(result).toEqual({ plan: "free", status: "expired" });
  });

  it("fails closed to Free when expiresAt is Infinity (never trust a non-expiring grant)", () => {
    const result = resolveEntitlementState(entitlement({ plan: "max", expiresAt: Infinity }), 1_000_000);
    expect(result).toEqual({ plan: "free", status: "expired" });
  });

  it("fails closed to Free when expiresAt is missing from a malformed response", () => {
    const malformed = entitlement({ plan: "max" }) as Partial<Entitlement> as Entitlement;
    delete (malformed as { expiresAt?: number }).expiresAt;
    const result = resolveEntitlementState(malformed, 1_000_000);
    expect(result).toEqual({ plan: "free", status: "expired" });
  });

  it("falls back to Free when plan is not a recognized value, without touching status", () => {
    const malformed = entitlement({ plan: "enterprise" as unknown as Entitlement["plan"], status: "active" });
    const result = resolveEntitlementState(malformed, 1_000_000);
    expect(result).toEqual({ plan: "free", status: "active" });
  });

  it("falls back to Free when plan is missing from a malformed response", () => {
    const malformed = entitlement() as Partial<Entitlement> as Entitlement;
    delete (malformed as { plan?: Entitlement["plan"] }).plan;
    const result = resolveEntitlementState(malformed, 1_000_000);
    expect(result.plan).toBe("free");
  });
});

describe("PLAN_LIMITS", () => {
  it("matches the product spec §8.2 structure — Free is the strictest, Max is unlimited", () => {
    expect(PLAN_LIMITS.free).toEqual({ agents: 2, connections: 2, councilSessions: 1 });
    expect(PLAN_LIMITS.pro.agents).toBeGreaterThan(PLAN_LIMITS.free.agents);
    expect(PLAN_LIMITS.max.agents).toBe(Infinity);
    expect(PLAN_LIMITS.max.connections).toBe(Infinity);
    expect(PLAN_LIMITS.max.councilSessions).toBe(Infinity);
  });
});

describe("isAtLimit", () => {
  it("allows creating up to (but not past) the limit", () => {
    expect(isAtLimit("agents", 0, PLAN_LIMITS.free)).toBe(false);
    expect(isAtLimit("agents", 1, PLAN_LIMITS.free)).toBe(false);
    expect(isAtLimit("agents", 2, PLAN_LIMITS.free)).toBe(true);
  });

  it("blocks past the limit too, not just exactly at it", () => {
    expect(isAtLimit("connections", 5, PLAN_LIMITS.free)).toBe(true);
  });

  it("never blocks an unlimited (Infinity) resource", () => {
    expect(isAtLimit("agents", 1_000_000, PLAN_LIMITS.max)).toBe(false);
    expect(isAtLimit("connections", 1_000_000, PLAN_LIMITS.pro)).toBe(false);
  });
});
