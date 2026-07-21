import { DEFAULT_OLLAMA_BASE_URL, listOllamaModels } from "@newvector/core";
import { useCallback, useState } from "react";
import { isTauriRuntime } from "./credentials";
import { getProviderFetch } from "./providerFetch";

/**
 * Fetches the models actually installed at an Ollama-compatible endpoint (`GET /api/tags`), so the
 * account form can offer real choices instead of a hardcoded guess. Reuses the same Rust relay as
 * chat inference in the desktop shell — the Rust `provider_fetch` command only relays to
 * `localhost`/`127.0.0.1` (see `apps/desktop/src-tauri/src/provider.rs`), so a remote/hosted endpoint
 * configured from the desktop app surfaces that as a rejected-host error rather than silently
 * failing; the plain browser build has no such allow-list and only depends on the endpoint's own
 * CORS policy.
 */
export async function discoverOllamaModels(baseURL: string): Promise<string[]> {
  try {
    return await listOllamaModels(baseURL, getProviderFetch() ?? fetch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isTauriRuntime() && /provider allow-list/i.test(message)) {
      throw new Error(
        "The desktop app can only reach a local Ollama instance (localhost/127.0.0.1) for security reasons. " +
          "For a remote or hosted endpoint, add this account from the browser app instead (it works if that endpoint allows cross-origin requests).",
      );
    }
    throw new Error(message);
  }
}

export type OllamaCheckStatus = "idle" | "loading" | "loaded" | "error";

export interface OllamaModelsState {
  models: string[];
  status: OllamaCheckStatus;
  error: string | null;
}

/**
 * Shared "test connection" state machine for the account forms (`AccountsManager`, `OnboardingWizard`)
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
