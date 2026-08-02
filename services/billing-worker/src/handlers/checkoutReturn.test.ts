import { describe, expect, it } from "vitest";
import { handleCheckoutReturn } from "./checkoutReturn";

describe("handleCheckoutReturn", () => {
  it("renders a success page", async () => {
    const response = handleCheckoutReturn(new Request("https://worker/checkout/return?status=success"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(await response.text()).toContain("You're upgraded");
  });

  it("renders a cancelled page", async () => {
    const response = handleCheckoutReturn(new Request("https://worker/checkout/return?status=cancelled"));
    expect(await response.text()).toContain("Checkout cancelled");
  });

  it("renders a portal page", async () => {
    const response = handleCheckoutReturn(new Request("https://worker/checkout/return?status=portal"));
    expect(await response.text()).toContain("Billing updated");
  });

  it("falls back to the success copy for an unknown/missing status", async () => {
    const response = handleCheckoutReturn(new Request("https://worker/checkout/return"));
    expect(await response.text()).toContain("You're upgraded");
  });
});
