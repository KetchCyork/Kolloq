import { describe, expect, it } from "vitest";
import { getAgentStatus } from "./agentStatus";
import type { Account, ProviderConfig } from "./types";

function account(patch: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    provider: "anthropic",
    label: "Work Anthropic",
    model: "claude-3-5-sonnet-20241022",
    authType: "api_key",
    apiKey: "sk-ant-test",
    createdAt: 0,
    ...patch,
  };
}

describe("getAgentStatus", () => {
  it("is ready when the referenced account has an API key", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "claude-3-5-sonnet-20241022", accountId: "acc-1" };
    expect(getAgentStatus(config, [account()]).status).toBe("ready");
  });

  it("is an error when the referenced account no longer exists", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x", accountId: "missing" };
    expect(getAgentStatus(config, [account()])).toMatchObject({ status: "error", label: "Connection error" });
  });

  it("is an error when an API-key account lost its key", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x", accountId: "acc-1" };
    expect(getAgentStatus(config, [account({ apiKey: undefined })])).toMatchObject({ status: "error" });
  });

  it("is an error when a subscription account has no access token", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x", accountId: "acc-1" };
    const sub = account({ authType: "subscription", apiKey: undefined, oauth: undefined });
    expect(getAgentStatus(config, [sub])).toMatchObject({ status: "error" });
  });

  it("is ready when a subscription account has a valid access token", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x", accountId: "acc-1" };
    const sub = account({ authType: "subscription", apiKey: undefined, oauth: { accessToken: "tok" } });
    expect(getAgentStatus(config, [sub]).status).toBe("ready");
  });

  it("is ready for legacy configs carrying their own API key with no accountId", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x", apiKey: "sk-legacy" };
    expect(getAgentStatus(config, []).status).toBe("ready");
  });

  it("is an error when nothing is configured at all", () => {
    const config: ProviderConfig = { provider: "anthropic", model: "x" };
    expect(getAgentStatus(config, [])).toMatchObject({ status: "error", label: "No connection" });
  });

  it("is ready for an Ollama account with no API key, since Ollama runs locally with no credentials", () => {
    const config: ProviderConfig = { provider: "ollama", model: "llama3.1", accountId: "acc-1" };
    const ollama = account({ provider: "ollama", authType: "api_key", apiKey: undefined, baseURL: "http://localhost:11434" });
    expect(getAgentStatus(config, [ollama]).status).toBe("ready");
  });

  it("is ready for a legacy Ollama config with no accountId and no API key", () => {
    const config: ProviderConfig = { provider: "ollama", model: "llama3.1" };
    expect(getAgentStatus(config, []).status).toBe("ready");
  });
});
