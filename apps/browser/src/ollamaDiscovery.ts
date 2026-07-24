import { listModels } from "@newvector/core";
import { useCallback, useState } from "react";

export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Fetches the models actually installed at an Ollama-compatible endpoint, so the account form can
 * offer real choices instead of a hardcoded guess. Reuses `@newvector/core`'s generic `listModels`
 * (the same call `AccountsManager`'s live model discovery makes) rather than a bespoke Ollama
 * client, so this stays in sync with however that function reaches the endpoint.
 */
export async function discoverOllamaModels(baseURL: string): Promise<string[]> {
  const models = await listModels({ provider: "ollama", baseURL });
  return models.map((model) => model.id);
}

export type OllamaCheckStatus = "idle" | "loading" | "loaded" | "error";

export interface OllamaModelsState {
  models: string[];
  status: OllamaCheckStatus;
  error: string | null;
}

/**
 * Shared "test connection" state machine for the account forms (`SettingsConnectionsPane`, `OnboardingWizard`)
 * that let a user configure an Ollama endpoint: runs discovery, tracks loading/error state, and
 * flags an empty model list as an error since that means nothing can actually be selected.
 */
export function useOllamaModels() {
  const [state, setState] = useState<OllamaModelsState>({ models: [], status: "idle", error: null });

  /**
   * Runs discovery. Pass `desiredModel` at save time to also flag — without silently overriding —
   * a model that isn't actually available at this endpoint.
   */
  const check = useCallback(async (baseURL: string, desiredModel?: string): Promise<string[]> => {
    setState({ models: [], status: "loading", error: null });
    try {
      const models = await discoverOllamaModels(baseURL.trim() || DEFAULT_OLLAMA_BASE_URL);
      let error: string | null = null;
      if (models.length === 0) {
        error = "No models found at this endpoint — pull one (e.g. `ollama pull llama3.1`) and test again.";
      } else if (desiredModel !== undefined && !models.includes(desiredModel)) {
        error = `Model "${desiredModel || "(none selected)"}" isn't available at this endpoint — pick one from the list.`;
      }
      setState({ models, status: "loaded", error });
      return models;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not reach the Ollama endpoint.";
      setState({ models: [], status: "error", error: message });
      return [];
    }
  }, []);

  const reset = useCallback(() => setState({ models: [], status: "idle", error: null }), []);

  return { ...state, check, reset };
}
