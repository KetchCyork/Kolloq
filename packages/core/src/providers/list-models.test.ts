import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAnthropicModels } from "./anthropic.js";
import { listGoogleModels } from "./google.js";
import { listModels } from "./index.js";
import { listOllamaModels } from "./ollama.js";
import { listOpenAiModels } from "./openai.js";
import { listOpenRouterModels } from "./openrouter.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

describe("listAnthropicModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requests /v1/models with the api key and browser-access headers, and maps the response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: [{ id: "claude-3-5-sonnet-20241022", display_name: "Claude 3.5 Sonnet" }] }),
    );

    const models = await listAnthropicModels({ apiKey: "sk-ant-test" });

    expect(models).toEqual([{ id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(init.headers["x-api-key"]).toBe("sk-ant-test");
    expect(init.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
  });

  it("uses a bearer token for subscription auth instead of x-api-key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }));

    await listAnthropicModels({ authType: "subscription", accessToken: "at-123" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.authorization).toBe("Bearer at-123");
    expect(init.headers["x-api-key"]).toBeUndefined();
  });

  it("throws when neither an api key nor a subscription token is available", async () => {
    await expect(listAnthropicModels({})).rejects.toThrow(/API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws a descriptive error on a non-ok response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 401));
    await expect(listAnthropicModels({ apiKey: "bad" })).rejects.toThrow(/401/);
  });
});

describe("listOpenAiModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("filters out non-chat models and sorts the rest", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: [{ id: "gpt-4o-mini" }, { id: "text-embedding-3-small" }, { id: "whisper-1" }, { id: "gpt-4o" }],
      }),
    );

    const models = await listOpenAiModels({ apiKey: "sk-test" });

    expect(models).toEqual([{ id: "gpt-4o" }, { id: "gpt-4o-mini" }]);
  });

  it("throws when no api key is provided", async () => {
    await expect(listOpenAiModels({})).rejects.toThrow(/API key/);
  });
});

describe("listGoogleModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps only models that support generateContent and strips the models/ prefix", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: [
          { name: "models/gemini-1.5-flash", displayName: "Gemini 1.5 Flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    );

    const models = await listGoogleModels({ apiKey: "goog-test" });

    expect(models).toEqual([{ id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("key=goog-test");
  });
});

describe("listOllamaModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hits the native /api/tags endpoint, not the OpenAI-compatible /v1 base", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ models: [{ name: "llama3.1" }, { model: "mistral:latest" }] }));

    const models = await listOllamaModels({ baseURL: "http://localhost:11434/v1" });

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
    expect(models).toEqual([{ id: "llama3.1" }, { id: "mistral:latest" }]);
  });

  it("excludes embedding-only models when the daemon reports capabilities", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        models: [
          { name: "nomic-embed-text:latest", capabilities: ["embedding"] },
          { name: "llama3.1:8b", capabilities: ["completion", "tools"] },
        ],
      }),
    );

    const models = await listOllamaModels({});

    expect(models).toEqual([{ id: "llama3.1:8b" }]);
  });
});

describe("listOpenRouterModels", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the public catalog without requiring an api key", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "openai/gpt-4o-mini", name: "GPT-4o mini" }] }));

    const models = await listOpenRouterModels({});

    expect(models).toEqual([{ id: "openai/gpt-4o-mini", label: "GPT-4o mini" }]);
  });
});

describe("fetchImpl relay routing (NEW-316)", () => {
  // The desktop shell passes a Tauri-backed `fetch` that relays through Rust to bypass webview
  // CORS. Every model-list request MUST use it when provided — without it the request fires from
  // the webview and is CORS-blocked on Windows WebView2 ("failed to download model list").
  const globalFetch = vi.fn();
  const relayFetch = vi.fn();
  beforeEach(() => {
    globalFetch.mockReset();
    relayFetch.mockReset();
    vi.stubGlobal("fetch", globalFetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("listAnthropicModels uses the injected fetchImpl, not the global fetch", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ data: [{ id: "claude-sonnet-5" }] }));

    const models = await listAnthropicModels({ apiKey: "sk-ant", fetchImpl: relayFetch as unknown as typeof fetch });

    expect(relayFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    expect(relayFetch.mock.calls[0][0]).toBe("https://api.anthropic.com/v1/models?limit=1000");
    expect(models).toEqual([{ id: "claude-sonnet-5", label: undefined }]);
  });

  it("listOpenAiModels uses the injected fetchImpl, not the global fetch", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ data: [{ id: "gpt-4o" }] }));

    await listOpenAiModels({ apiKey: "sk", fetchImpl: relayFetch as unknown as typeof fetch });

    expect(relayFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("listGoogleModels uses the injected fetchImpl, not the global fetch", async () => {
    relayFetch.mockResolvedValue(jsonResponse({ models: [] }));

    await listGoogleModels({ apiKey: "goog", fetchImpl: relayFetch as unknown as typeof fetch });

    expect(relayFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("falls back to the global fetch when no fetchImpl is given (plain browser build)", async () => {
    globalFetch.mockResolvedValue(jsonResponse({ data: [] }));

    await listAnthropicModels({ apiKey: "sk-ant" });

    expect(globalFetch).toHaveBeenCalledTimes(1);
    expect(relayFetch).not.toHaveBeenCalled();
  });
});

describe("listModels dispatcher", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("routes to the right provider implementation", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: "openai/gpt-4o-mini" }] }));
    const models = await listModels({ provider: "openrouter" });
    expect(models).toEqual([{ id: "openai/gpt-4o-mini", label: undefined }]);
  });
});
