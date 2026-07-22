import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";
import { writeSandboxedFile } from "./sandbox.js";

/**
 * Office document generators — let an agent produce real Word (.docx), Excel (.xlsx), and
 * PowerPoint (.pptx) files on request ("generate this report as a Word doc", "create a spreadsheet
 * with this data"). Each tool renders structured JSON the model provides into a binary buffer and
 * writes it into the same sandboxed `rootDir` used by the file tools, returning `{ path, bytesWritten }`
 * so the file can be downloaded from the browser/desktop app. These libraries are Node-only, so this
 * module is exported from `@newvector/core/node`, not the browser-safe default entrypoint.
 */

function ensureExtension(requested: string, ext: string): string {
  return requested.toLowerCase().endsWith(ext) ? requested : `${requested}${ext}`;
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

const wordBlockSchema = z.discriminatedUnion("type", [
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

const wordParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'report.docx'"),
  title: z.string().optional().describe("Optional document title rendered as a top heading"),
  blocks: z
    .array(wordBlockSchema)
    .describe("Ordered content blocks: headings, paragraphs, and bullet lists"),
});

async function generateWord(args: z.input<typeof wordParams>) {
  const headingFor = (level: number) =>
    [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ][level - 1] ?? HeadingLevel.HEADING_1;

  const children: InstanceType<typeof Paragraph>[] = [];
  if (args.title) children.push(new Paragraph({ text: args.title, heading: HeadingLevel.TITLE }));
  for (const block of args.blocks) {
    if (block.type === "heading") {
      children.push(new Paragraph({ text: block.text, heading: headingFor(block.level ?? 1) }));
    } else if (block.type === "paragraph") {
      children.push(new Paragraph({ children: [new TextRun(block.text)] }));
    } else {
      for (const item of block.items) {
        children.push(new Paragraph({ text: item, bullet: { level: 0 } }));
      }
    }
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Excel (.xlsx)
// ---------------------------------------------------------------------------

const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const sheetSchema = z.object({
  name: z.string().describe("Worksheet name"),
  columns: z.array(z.string()).optional().describe("Optional header row rendered in bold"),
  rows: z.array(z.array(cellSchema)).describe("Data rows; each row is an array of cell values"),
});

const excelParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'data.xlsx'"),
  sheets: z.array(sheetSchema).min(1).describe("One or more worksheets"),
});

async function generateExcel(args: z.infer<typeof excelParams>) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  for (const sheet of args.sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    if (sheet.columns && sheet.columns.length > 0) {
      const header = ws.addRow(sheet.columns);
      header.font = { bold: true };
    }
    for (const row of sheet.rows) ws.addRow(row);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// PowerPoint (.pptx)
// ---------------------------------------------------------------------------

const slideSchema = z.object({
  title: z.string().optional().describe("Slide title"),
  bullets: z.array(z.string()).optional().describe("Bullet points for the slide body"),
  body: z.string().optional().describe("Free-form body text (used when bullets are not given)"),
});

const pptParams = z.object({
  path: z.string().describe("Output path relative to the sandboxed root, e.g. 'deck.pptx'"),
  title: z.string().optional().describe("Optional deck title used for the first slide"),
  slides: z.array(slideSchema).min(1).describe("Ordered slides"),
});

// pptxgenjs ships a CJS default export that NodeNext resolves to the module namespace rather than the
// class, and `PptxGenJS` is only usable as a namespace (not a type), so derive the instance type from
// its `default` member and assert the constructor signature.
type PptxInstance = InstanceType<(typeof PptxGenJS)["default"]>;

async function generatePowerPoint(args: z.infer<typeof pptParams>) {
  const pptx: PptxInstance = new (PptxGenJS as unknown as new () => PptxInstance)();

  if (args.title) {
    const cover = pptx.addSlide();
    cover.addText(args.title, { x: 0.5, y: 2.2, w: 9, h: 1.2, fontSize: 36, bold: true, align: "center" });
  }

  for (const slide of args.slides) {
    const s = pptx.addSlide();
    if (slide.title) {
      s.addText(slide.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
    }
    if (slide.bullets && slide.bullets.length > 0) {
      s.addText(
        slide.bullets.map((text) => ({ text, options: { bullet: true } })),
        { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 18 },
      );
    } else if (slide.body) {
      s.addText(slide.body, { x: 0.5, y: 1.3, w: 9, h: 5, fontSize: 18 });
    }
  }

  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(out as Buffer);
}

/**
 * Builds the three Office document generation tools scoped to `rootDir`. Generated files land inside
 * the sandbox exactly like `write_file`, so the browser/desktop app can offer them for download.
 */
export function createOfficeTools(rootDir: string): ToolDefinition[] {
  return [
    defineTool({
      name: "generate_word_document",
      description: `Generate a Microsoft Word (.docx) document from structured content and save it relative to the sandboxed root (${rootDir}). Use for reports, letters, and formatted prose.`,
      parameters: wordParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".docx");
        const buffer = await generateWord(args);
        const bytesWritten = await writeSandboxedFile(rootDir, target, buffer);
        return { path: target, bytesWritten };
      },
    }),
    defineTool({
      name: "generate_excel_spreadsheet",
      description: `Generate a Microsoft Excel (.xlsx) spreadsheet from one or more sheets of tabular data and save it relative to the sandboxed root (${rootDir}).`,
      parameters: excelParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".xlsx");
        const buffer = await generateExcel(args);
        const bytesWritten = await writeSandboxedFile(rootDir, target, buffer);
        return { path: target, bytesWritten };
      },
    }),
    defineTool({
      name: "generate_powerpoint_presentation",
      description: `Generate a Microsoft PowerPoint (.pptx) presentation from a list of slides and save it relative to the sandboxed root (${rootDir}).`,
      parameters: pptParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".pptx");
        const buffer = await generatePowerPoint(args);
        const bytesWritten = await writeSandboxedFile(rootDir, target, buffer);
        return { path: target, bytesWritten };
      },
    }),
  ];
}
