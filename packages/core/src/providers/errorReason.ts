import { APICallError, LoadAPIKeyError, NoSuchModelError } from "ai";

/**
 * A provider error boiled down for a non-technical user: a short human-readable cause, whether the
 * fix is something the user can do in their own account setup (so the UI can point at Manage
 * Accounts), and the original message so nothing is ever hidden.
 */
export interface ProviderErrorReason {
  reason: string;
  isConfigIssue: boolean;
  raw: string;
}

const AUTH_PATTERN = /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[_ -]?api[_ -]?key|incorrect api key|api key not (found|valid)/i;
const MODEL_NOT_FOUND_PATTERN = /model.*?(not found|does not exist|try pulling)|no such model|unknown model|model_not_found/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate.?limit(ed)?|too many requests/i;
const CONNECTIVITY_PATTERN =
  /econnrefused|enotfound|etimedout|fetch failed|failed to fetch|network ?error|could not connect|connection refused|timed? ?out/i;
const SERVER_ERROR_PATTERN = /\b5\d\d\b|internal server error|bad gateway|service unavailable/i;

/**
 * Classifies a provider/network failure into a short, human-readable reason. Accepts either a real
 * `Error` (from a direct provider call, where AI SDK error subclasses and `statusCode` are
 * available for precise classification) or a plain string (from an already-stringified error, e.g.
 * the Advisory Council's per-member/moderator failures, which cross an event boundary as text) —
 * falls back to pattern-matching the message in both cases so neither path is left with a raw SDK
 * error string when a clearer explanation is feasible.
 */
export function classifyProviderError(error: unknown): ProviderErrorReason {
  const err = error instanceof Error ? error : new Error(String(error));
  const raw = err.message;

  if (NoSuchModelError.isInstance(err)) {
    return {
      reason: `Model "${err.modelId}" not found — check the model name in Manage Accounts.`,
      isConfigIssue: true,
      raw,
    };
  }

  if (LoadAPIKeyError.isInstance(err)) {
    return { reason: "No API key configured for this provider — add one in Manage Accounts.", isConfigIssue: true, raw };
  }

  if (APICallError.isInstance(err)) {
    const status = err.statusCode;
    if (status === 401 || status === 403) {
      return {
        reason: "Authentication failed — check the API key or sign-in in Manage Accounts.",
        isConfigIssue: true,
        raw,
      };
    }
    if (status === 429) {
      return { reason: "Rate limited by the provider — wait a moment and try again.", isConfigIssue: false, raw };
    }
    if (status && status >= 500) {
      return { reason: "The provider's servers returned an error. Try again shortly.", isConfigIssue: false, raw };
    }
  }

  const haystack = `${raw} ${(err as { responseBody?: string }).responseBody ?? ""}`;

  if (MODEL_NOT_FOUND_PATTERN.test(haystack)) {
    return { reason: "Model not found — check the model name in Manage Accounts.", isConfigIssue: true, raw };
  }
  if (AUTH_PATTERN.test(haystack)) {
    return {
      reason: "Authentication failed — check the API key or sign-in in Manage Accounts.",
      isConfigIssue: true,
      raw,
    };
  }
  if (CONNECTIVITY_PATTERN.test(haystack)) {
    return {
      reason: "Couldn't reach the provider endpoint — check the base URL and that it's running in Manage Accounts.",
      isConfigIssue: true,
      raw,
    };
  }
  if (RATE_LIMIT_PATTERN.test(haystack)) {
    return { reason: "Rate limited by the provider — wait a moment and try again.", isConfigIssue: false, raw };
  }
  if (SERVER_ERROR_PATTERN.test(haystack)) {
    return { reason: "The provider's servers returned an error. Try again shortly.", isConfigIssue: false, raw };
  }

  return { reason: raw, isConfigIssue: false, raw };
}
