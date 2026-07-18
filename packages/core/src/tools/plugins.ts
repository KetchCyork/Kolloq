import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolDefinition } from "../providers/types.js";

export type ToolPluginExport =
  | ToolDefinition
  | ToolDefinition[]
  | (() => ToolDefinition | ToolDefinition[] | Promise<ToolDefinition | ToolDefinition[]>);

function isToolDefinition(value: unknown): value is ToolDefinition {
  const candidate = value as Partial<ToolDefinition> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.name === "string" &&
    typeof candidate.description === "string" &&
    typeof candidate.execute === "function" &&
    typeof (candidate.parameters as { parse?: unknown } | undefined)?.parse === "function"
  );
}

/**
 * Loads custom tools by dynamically importing every `.js` file in `dir`. Drop a file into the
 * project's `tools/` folder whose default export is a `ToolDefinition` (or a factory returning
 * one or more), and it's picked up here without touching core code. Missing directories return
 * an empty list rather than throwing, since the plugin folder is optional.
 */
export async function loadToolPlugins(dir: string): Promise<ToolDefinition[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const tools: ToolDefinition[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".js") || name.endsWith(".mjs")).sort()) {
    const filePath = path.join(dir, entry);
    const mod = (await import(pathToFileURL(filePath).href)) as { default?: ToolPluginExport };
    if (mod.default === undefined) {
      throw new Error(`Tool plugin "${entry}" has no default export`);
    }
    const resolved = typeof mod.default === "function" ? await mod.default() : mod.default;
    for (const tool of Array.isArray(resolved) ? resolved : [resolved]) {
      if (!isToolDefinition(tool)) {
        throw new Error(`Tool plugin "${entry}" did not export a valid ToolDefinition`);
      }
      tools.push(tool);
    }
  }
  return tools;
}
