import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchToolOptions {
  provider: "brave" | "serper";
  apiKey: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

async function searchBrave(query: string, apiKey: string, fetchImpl: typeof fetch): Promise<WebSearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  const response = await fetchImpl(url, { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`Brave search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
  return (data.web?.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function searchSerper(query: string, apiKey: string, fetchImpl: typeof fetch): Promise<WebSearchResult[]> {
  const response = await fetchImpl("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query }),
  });
  if (!response.ok) {
    throw new Error(`Serper search failed: ${response.status} ${response.statusText}`);
  }
  const data = (await response.json()) as { organic?: { title: string; link: string; snippet: string }[] };
  return (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
}

/** Web search tool backed by either the Brave Search API or Serper (Google SERP proxy). */
export function createWebSearchTool(options: WebSearchToolOptions): ToolDefinition {
  const fetchImpl = options.fetchImpl ?? fetch;

  return defineTool({
    name: "web_search",
    description: "Search the web and return a short list of results (title, url, snippet).",
    parameters: z.object({ query: z.string() }),
    execute: async ({ query }): Promise<{ results: WebSearchResult[] }> => {
      const results =
        options.provider === "brave"
          ? await searchBrave(query, options.apiKey, fetchImpl)
          : await searchSerper(query, options.apiKey, fetchImpl);
      return { results: results.slice(0, 10) };
    },
  });
}
