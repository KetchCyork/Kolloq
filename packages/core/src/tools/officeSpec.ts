import { z } from "zod";

/**
 * Browser-safe descriptions of the Office document generators — the parameter schemas and
 * tool metadata, with NO `docx`/`exceljs`/`pptxgenjs` (Node-only) imports.
 *
 * Two consumers share this one source of truth:
 *  - The real generators in `builtin/office.ts` (`@newvector/core/node`), which import these
 *    schemas and do the actual rendering with the Node-only libraries.
 *  - The browser/desktop proxy tools (`nodeProxy.ts`), which advertise the exact same schema to
 *    the model but route execution to a Node execution context (the desktop sidecar) instead of
 *    running the Node-only libraries in the browser bundle.
 *
 * Keeping the schemas here (not in the Node-only module) means the browser bundle can present the
 * Office tools to the model without pulling `docx` & friends into a browser build.
 */

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

export const wordBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    text: z.string(),
    level: z.number().int().min(1).max(6).default(1).describe("Heading level 1-6"),
  }),
  z.object({ type: z.literal("paragraph"), text: z.string() }),
  z.object({
    type: z.literal("bullets"),
    items: z.array(z.string()).describe("List items, each rendered as its own bullet"),
  }),
]);

export const wordParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'report.docx'"),
  title: z.string().optional().describe("Optional document title rendered as a top heading"),
  blocks: z
    .array(wordBlockSchema)
    .describe("Ordered content blocks: headings, paragraphs, and bullet lists"),
});

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------

export const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const sheetSchema = z.object({
  name: z.string().describe("Worksheet name"),
  columns: z.array(z.string()).optional().describe("Optional header row rendered in bold"),
  rows: z.array(z.array(cellSchema)).describe("Data rows; each row is an array of cell values"),
});

export const excelParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'data.xlsx'"),
  sheets: z.array(sheetSchema).min(1).describe("One or more worksheets"),
});

// ---------------------------------------------------------------------------
// PowerPoint (.pptx)
// ---------------------------------------------------------------------------

export const slideSchema = z.object({
  title: z.string().optional().describe("Slide title"),
  bullets: z.array(z.string()).optional().describe("Bullet points for the slide body"),
  body: z.string().optional().describe("Free-form body text (used when bullets are not given)"),
});

export const pptParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'deck.pptx'"),
  title: z.string().optional().describe("Optional deck title used for the first slide"),
  slides: z.array(slideSchema).min(1).describe("Ordered slides"),
});

/** Metadata for one Office generator: its name, a description factory, and its parameter schema. */
export interface OfficeToolSpec {
  name: string;
  /** Builds the tool description; takes the sandbox root label the model is scoped to. */
  describe: (rootLabel: string) => string;
  parameters: z.ZodType;
}

/**
 * The three Office generators, described identically for the Node generators and the desktop
 * proxies. The `name`s must match `createOfficeTools` in `builtin/office.ts` exactly — the proxy
 * routes a call to the Node context by name.
 */
export const OFFICE_TOOL_SPECS: readonly OfficeToolSpec[] = [
  {
    name: "generate_word_document",
    describe: (root) =>
      `Generate a Microsoft Word (.docx) document from structured content and save it relative to the sandboxed root (${root}). Use for reports, letters, and formatted prose.`,
    parameters: wordParams,
  },
  {
    name: "generate_excel_spreadsheet",
    describe: (root) =>
      `Generate a Microsoft Excel (.xlsx) spreadsheet from one or more sheets of tabular data and save it relative to the sandboxed root (${root}).`,
    parameters: excelParams,
  },
  {
    name: "generate_powerpoint_presentation",
    describe: (root) =>
      `Generate a Microsoft PowerPoint (.pptx) presentation from a list of slides and save it relative to the sandboxed root (${root}).`,
    parameters: pptParams,
  },
] as const;

/** The tool names the Node execution context knows how to run, for quick membership checks. */
export const OFFICE_TOOL_NAMES: readonly string[] = OFFICE_TOOL_SPECS.map((s) => s.name);
