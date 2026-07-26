import { describe, expect, it, vi } from "vitest";
import { verifyEntitlementToken } from "../entitlementToken";
import { putCustomerRecord } from "../kv";
import { createInMemoryKv } from "../testFixtures";
import type { Env } from "../types";

vi.mock("../googleAuth", () => ({
  requireGoogleUser: vi.fn().mockResolvedValue("user@example.com"),
}));

const { handleEntitlement } = await import("./entitlement");

function makeEnv(): Env {
  return { BILLING_KV: createInMemoryKv(), ENTITLEMENT_SIGNING_SECRET: "test-secret-value" } as unknown as Env;
}

describe("handleEntitlement", () => {
  it("defaults to the free plan when no customer record exists", async () => {
    const env = makeEnv();
    const response = await handleEntitlement(new Request("https://worker/entitlement"), env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.plan).toBe("free");
    expect(body.status).toBe("active");
    expect(body.currentPeriodEnd).toBeNull();

    const claims = await verifyEntitlementToken(body.token as string, env);
    expect(claims).toEqual({ email: "user@example.com", plan: "free", status: "active" });
  });

  it("reflects a stored subscription's plan and status", async () => {
    const env = makeEnv();
    await putCustomerRecord(env, "cus_1", { email: "user@example.com", plan: "max", status: "active", currentPeriodEnd: 999 });

    const response = await handleEntitlement(new Request("https://worker/entitlement"), env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.plan).toBe("max");
    expect(body.currentPeriodEnd).toBe(999);
  });
});
