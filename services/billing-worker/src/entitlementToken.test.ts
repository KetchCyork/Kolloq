import { describe, expect, it } from "vitest";
import { signEntitlementToken, verifyEntitlementToken } from "./entitlementToken";
import type { Env } from "./types";

const env = { ENTITLEMENT_SIGNING_SECRET: "a-sufficiently-long-test-secret-value" } as Env;

describe("entitlement token", () => {
  it("round-trips the signed claims", async () => {
    const token = await signEntitlementToken({ email: "user@example.com", plan: "pro", status: "active" }, env);
    const claims = await verifyEntitlementToken(token, env);
    expect(claims).toEqual({ email: "user@example.com", plan: "pro", status: "active" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signEntitlementToken({ email: "user@example.com", plan: "max", status: "active" }, env);
    const otherEnv = { ENTITLEMENT_SIGNING_SECRET: "a-completely-different-secret-value" } as Env;
    await expect(verifyEntitlementToken(token, otherEnv)).rejects.toThrow();
  });

  it("rejects a tampered token", async () => {
    const token = await signEntitlementToken({ email: "user@example.com", plan: "free", status: "active" }, env);
    const tampered = token.slice(0, -2) + (token.slice(-2) === "AA" ? "BB" : "AA");
    await expect(verifyEntitlementToken(tampered, env)).rejects.toThrow();
  });
});
