import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserAccessFetch, stripDeprecatedSamplingParams } from "./anthropic.js";

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

  it("strips the deprecated temperature the AI SDK injects, without touching the rest of the body", async () => {
    // The Vercel AI SDK v4 core forces `temperature: 0` onto every request; newer Anthropic
    // models 400 on it (NEW-127). The wrapper must drop it before the call goes out.
    await browserAccessFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-sonnet-5", temperature: 0, max_tokens: 1024, stream: true }),
    });

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body as string);
    expect(sent).not.toHaveProperty("temperature");
    expect(sent).toEqual({ model: "claude-sonnet-5", max_tokens: 1024, stream: true });
  });
});

describe("stripDeprecatedSamplingParams", () => {
  it("removes temperature, top_p, and top_k from a JSON body", () => {
    const out = stripDeprecatedSamplingParams(
      JSON.stringify({ model: "claude-opus-5", temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens: 8 }),
    );
    expect(JSON.parse(out as string)).toEqual({ model: "claude-opus-5", max_tokens: 8 });
  });

  it("returns the body unchanged when there are no sampling params to strip", () => {
    const body = JSON.stringify({ model: "claude-opus-5", max_tokens: 8 });
    expect(stripDeprecatedSamplingParams(body)).toBe(body);
  });

  it("leaves non-JSON and empty bodies untouched", () => {
    expect(stripDeprecatedSamplingParams(undefined)).toBeUndefined();
    expect(stripDeprecatedSamplingParams(null)).toBeNull();
    expect(stripDeprecatedSamplingParams("")).toBe("");
    expect(stripDeprecatedSamplingParams("not json")).toBe("not json");
  });
});
