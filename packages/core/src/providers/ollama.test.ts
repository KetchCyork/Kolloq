import { describe, expect, it, vi } from "vitest";
import { listOllamaModels } from "./ollama.js";

function fakeFetch(response: Partial<Response> & { ok: boolean; status?: number; statusText?: string; json?: () => Promise<unknown> }) {
  return vi.fn(async () => response as Response);
}

describe("listOllamaModels", () => {
  it("returns model names from a successful /api/tags response", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => ({ models: [{ name: "llama3.1:latest" }, { name: "qwen2.5-coder:7b" }] }),
    });
    const models = await listOllamaModels("http://localhost:11434/v1", fetchImpl);
    expect(models).toEqual(["llama3.1:latest", "qwen2.5-coder:7b"]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.objectContaining({ method: "GET" }));
  });

  it("strips a trailing /v1 before hitting the native tags route", async () => {
    const fetchImpl = fakeFetch({ ok: true, json: async () => ({ models: [] }) });
    await listOllamaModels("http://my-remote-host:11434/v1/", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("http://my-remote-host:11434/api/tags", expect.anything());
  });

  it("falls back to the default host when no base URL is given", async () => {
    const fetchImpl = fakeFetch({ ok: true, json: async () => ({ models: [] }) });
    await listOllamaModels(undefined, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:11434/api/tags", expect.anything());
  });

  it("returns an empty list when the endpoint has no models pulled", async () => {
    const fetchImpl = fakeFetch({ ok: true, json: async () => ({ models: [] }) });
    const models = await listOllamaModels("http://localhost:11434/v1", fetchImpl);
    expect(models).toEqual([]);
  });

  it("throws a clear message on a non-2xx response", async () => {
    const fetchImpl = fakeFetch({ ok: false, status: 404, statusText: "Not Found" });
    await expect(listOllamaModels("http://localhost:11434/v1", fetchImpl)).rejects.toThrow(/404/);
  });

  it("throws a clear message when the fetch itself fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    await expect(listOllamaModels("http://localhost:11434/v1", fetchImpl)).rejects.toThrow(/Could not reach/);
  });

  it("throws a clear message on malformed JSON", async () => {
    const fetchImpl = fakeFetch({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });
    await expect(listOllamaModels("http://localhost:11434/v1", fetchImpl)).rejects.toThrow(/valid JSON/);
  });
});
