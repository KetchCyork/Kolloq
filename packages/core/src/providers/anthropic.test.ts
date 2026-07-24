import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserAccessFetch } from "./anthropic.js";

describe("browserAccessFetch", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds the browser-access header without dropping existing headers", async () => {
    await browserAccessFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": "sk-ant-test" },
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Headers;
    expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(headers.get("x-api-key")).toBe("sk-ant-test");
  });
});
