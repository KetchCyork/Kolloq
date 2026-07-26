import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { classifyProviderError } from "./errorReason.js";

function apiError(statusCode: number, message = "request failed") {
  return new APICallError({ message, url: "https://example.test", requestBodyValues: {}, statusCode });
}

describe("classifyProviderError", () => {
  it("flags a 401 as an auth config issue", () => {
    const result = classifyProviderError(apiError(401, "Unauthorized"));
    expect(result.isConfigIssue).toBe(true);
    expect(result.reason).toMatch(/authentication failed/i);
    expect(result.raw).toBe("Unauthorized");
  });

  it("flags a 403 as an auth config issue", () => {
    const result = classifyProviderError(apiError(403, "Forbidden"));
    expect(result.isConfigIssue).toBe(true);
    expect(result.reason).toMatch(/authentication failed/i);
  });

  it("does not flag a 429 as a config issue", () => {
    const result = classifyProviderError(apiError(429, "Too Many Requests"));
    expect(result.isConfigIssue).toBe(false);
    expect(result.reason).toMatch(/rate limited/i);
  });

  it("does not flag a 500 as a config issue", () => {
    const result = classifyProviderError(apiError(500, "Internal Server Error"));
    expect(result.isConfigIssue).toBe(false);
    expect(result.reason).toMatch(/provider's servers returned an error/i);
  });

  it("classifies an Ollama-style model-not-found message from a plain string", () => {
    const result = classifyProviderError("model 'ghost-model' not found, try pulling it first");
    expect(result.isConfigIssue).toBe(true);
    expect(result.reason).toMatch(/model not found/i);
  });

  it("classifies a connection-refused failure as a config issue", () => {
    const result = classifyProviderError(new Error("fetch failed: connect ECONNREFUSED 127.0.0.1:11434"));
    expect(result.isConfigIssue).toBe(true);
    expect(result.reason).toMatch(/couldn't reach the provider endpoint/i);
  });

  it("falls back to the raw message when nothing matches", () => {
    const result = classifyProviderError(new Error("something bizarre happened"));
    expect(result.isConfigIssue).toBe(false);
    expect(result.reason).toBe("something bizarre happened");
    expect(result.raw).toBe("something bizarre happened");
  });

  it("accepts a non-Error value", () => {
    const result = classifyProviderError("plain string error");
    expect(result.raw).toBe("plain string error");
  });
});
