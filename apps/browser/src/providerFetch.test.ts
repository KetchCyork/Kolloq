import { afterEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

import { getProviderFetch } from "./providerFetch";

describe("getProviderFetch", () => {
  afterEach(() => {
    invokeMock.mockReset();
    delete (globalThis as Record<string, unknown>).window;
  });

  it("returns undefined outside the Tauri runtime (falls back to global fetch)", () => {
    expect(getProviderFetch()).toBeUndefined();
  });

  it("routes a request through the provider_fetch command and rebuilds a Response", async () => {
    (globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} };
    invokeMock.mockResolvedValue({
      status: 200,
      statusText: "OK",
      headers: [["content-type", "application/json"]],
      body: '{"ok":true}',
    });

    const fetchImpl = getProviderFetch();
    expect(fetchImpl).toBeDefined();

    const res = await fetchImpl!("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "secret-key" },
      body: '{"a":1}',
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(await res.json()).toEqual({ ok: true });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, payload] = invokeMock.mock.calls[0] as [string, { request: { url: string; method: string; headers: [string, string][]; body: string | null } }];
    expect(command).toBe("provider_fetch");
    expect(payload.request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(payload.request.method).toBe("POST");
    expect(payload.request.body).toBe('{"a":1}');
    expect(payload.request.headers).toContainEqual(["x-api-key", "secret-key"]);
  });
});
