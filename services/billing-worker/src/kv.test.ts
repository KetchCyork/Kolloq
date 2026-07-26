import { describe, expect, it } from "vitest";
import { getCustomerIdForEmail, getCustomerRecord, putCustomerRecord } from "./kv";
import { createInMemoryKv } from "./testFixtures";
import type { Env } from "./types";

describe("kv helpers", () => {
  it("putCustomerRecord stores the record and the email->customer mapping together", async () => {
    const env = { BILLING_KV: createInMemoryKv() } as unknown as Env;

    await putCustomerRecord(env, "cus_123", { email: "user@example.com", plan: "pro", status: "active", currentPeriodEnd: 1234 });

    expect(await getCustomerIdForEmail(env, "user@example.com")).toBe("cus_123");
    expect(await getCustomerRecord(env, "cus_123")).toEqual({
      email: "user@example.com",
      plan: "pro",
      status: "active",
      currentPeriodEnd: 1234,
    });
  });

  it("returns null for unknown keys", async () => {
    const env = { BILLING_KV: createInMemoryKv() } as unknown as Env;
    expect(await getCustomerIdForEmail(env, "nobody@example.com")).toBeNull();
    expect(await getCustomerRecord(env, "cus_missing")).toBeNull();
  });
});
