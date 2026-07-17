import type { AgentSession } from "../types";
import { PROVIDER_DEFAULT_MODELS, PROVIDER_LABELS, PROVIDER_NAMES } from "../utils";
import type { ProviderName } from "../types";

export function ProviderConfigForm({
  session,
  onChange,
}: {
  session: AgentSession;
  onChange: (patch: Partial<Pick<AgentSession, "identity" | "providerConfig" | "systemPrompt">>) => void;
}) {
  const { identity, providerConfig, systemPrompt } = session;

  function setProvider(provider: ProviderName) {
    onChange({ providerConfig: { ...providerConfig, provider, model: PROVIDER_DEFAULT_MODELS[provider] } });
  }

  return (
    <div className="settings-panel">
      <div className="field">
        <label htmlFor="agent-name">Agent name</label>
        <input
          id="agent-name"
          value={identity.name}
          onChange={(e) => onChange({ identity: { ...identity, name: e.target.value } })}
        />
      </div>

      <div className="field">
        <label htmlFor="agent-color">Color</label>
        <input
          id="agent-color"
          type="color"
          value={identity.color}
          onChange={(e) => onChange({ identity: { ...identity, color: e.target.value } })}
        />
      </div>

      <div className="field">
        <label htmlFor="provider">Provider</label>
        <select id="provider" value={providerConfig.provider} onChange={(e) => setProvider(e.target.value as ProviderName)}>
          {PROVIDER_NAMES.map((name) => (
            <option key={name} value={name}>
              {PROVIDER_LABELS[name]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="model">Model</label>
        <input
          id="model"
          value={providerConfig.model}
          onChange={(e) => onChange({ providerConfig: { ...providerConfig, model: e.target.value } })}
        />
      </div>

      {providerConfig.provider === "ollama" ? (
        <div className="field">
          <label htmlFor="baseurl">Ollama base URL</label>
          <input
            id="baseurl"
            placeholder="http://localhost:11434/v1"
            value={providerConfig.baseURL ?? ""}
            onChange={(e) => onChange({ providerConfig: { ...providerConfig, baseURL: e.target.value || undefined } })}
          />
        </div>
      ) : (
        <div className="field">
          <label htmlFor="apikey">API key</label>
          <input
            id="apikey"
            type="password"
            placeholder="sk-..."
            value={providerConfig.apiKey ?? ""}
            onChange={(e) => onChange({ providerConfig: { ...providerConfig, apiKey: e.target.value || undefined } })}
          />
        </div>
      )}

      <div className="field span-full">
        <label htmlFor="system-prompt">System prompt</label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </div>
    </div>
  );
}
