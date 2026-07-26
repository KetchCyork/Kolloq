import { describe, expect, it, vi } from "vitest";
import { createInMemoryKv } from "../testFixtures";
import type { Env } from "../types";

vi.mock("../googleAuth", () => ({
  requireGoogleUser: vi.fn().mockResolvedValue("user@example.com"),
}));

const createPortalSession = vi.fn().mockResolvedValue({ id: "bps_1", url: "https://billing.stripe.com/session/bps_1" });
vi.mock("../stripeClient", () => ({
  createPortalSession: (...args: unknown[]) => createPortalSession(...args),
}));

const { handlePortalSession } = await import("./portalSession");

function makeEnv(): Env {
  return { BILLING_KV: createInMemoryKv(), DEFAULT_PORTAL_RETURN_URL: "https://app.example.com/account" } as unknown as Env;
}

describe("handlePortalSession", () => {
  it("404s when the user has no billing account yet", async () => {
    // Handlers throw HttpError and let the top-level router (src/index.ts) map it to a Response.
    await expect(
      handlePortalSession(new Request("https://worker/portal-session", { method: "POST" }), makeEnv()),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("creates a portal session for an existing customer", async () => {
    const env = makeEnv();
    await env.BILLING_KV.put("email:user@example.com", "cus_existing");

    const response = await handlePortalSession(new Request("https://worker/portal-session", { method: "POST" }), env);
    const body = (await response.json()) as Record<string, unknown>;

    expect(body.url).toBe("https://billing.stripe.com/session/bps_1");
    expect(createPortalSession).toHaveBeenCalledWith(env, "cus_existing", "https://app.example.com/account");
  });
});
