import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { defineTool } from "../registry.js";
import type { ToolDefinition } from "../../providers/types.js";
import { mimeTypeForPath, type FileArtifact } from "../artifacts.js";
import { OFFICE_TOOL_SPECS, wordParams, excelParams, pptParams } from "../officeSpec.js";
import { writeSandboxedFile } from "./sandbox.js";

/**
 * Office document generators — let an agent produce real Word (.docx), Excel (.xlsx), and
 * PowerPoint (.pptx) files on request ("generate this report as a Word doc", "create a spreadsheet
 * with this data"). Each tool renders structured JSON the model provides into a binary buffer and
 * writes it into the same sandboxed `rootDir` used by the file tools, returning a {@link FileArtifact}
 * (`{ path, bytesWritten, mimeType, contentBase64 }`) so the file can be downloaded from the
 * browser/desktop app. These libraries are Node-only, so this module is exported from
 * `@newvector/core/node`, not the browser-safe default entrypoint.
 */

function ensureExtension(requested: string, ext: string): string {
  return requested.toLowerCase().endsWith(ext) ? requested : `${requested}${ext}`;
}

/**
 * Writes a generated document into the sandbox and returns the shared {@link FileArtifact} shape so the
 * browser/desktop download surface can offer it. The bytes are carried inline as base64 (`contentBase64`)
 * because the browser can't reach the sandbox disk; the AgentRunner strips them from what the model sees.
 */
async function writeArtifact(rootDir: string, target: string, buffer: Buffer): Promise<FileArtifact> {
  const bytesWritten = await writeSandboxedFile(rootDir, target, buffer);
  return {
    path: target,
    bytesWritten,
    mimeType: mimeTypeForPath(target),
    contentBase64: buffer.toString("base64"),
  };
}

// ---------------------------------------------------------------------------
// Word (.docx)
// ---------------------------------------------------------------------------

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
  const specByName = Object.fromEntries(OFFICE_TOOL_SPECS.map((s) => [s.name, s]));
  return [
    defineTool({
      name: "generate_word_document",
      description: specByName.generate_word_document.describe(rootDir),
      parameters: wordParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".docx");
        const buffer = await generateWord(args);
        return writeArtifact(rootDir, target, buffer);
      },
    }),
    defineTool({
      name: "generate_excel_spreadsheet",
      description: specByName.generate_excel_spreadsheet.describe(rootDir),
      parameters: excelParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".xlsx");
        const buffer = await generateExcel(args);
        return writeArtifact(rootDir, target, buffer);
      },
    }),
    defineTool({
      name: "generate_powerpoint_presentation",
      description: specByName.generate_powerpoint_presentation.describe(rootDir),
      parameters: pptParams,
      execute: async (args) => {
        const target = ensureExtension(args.path, ".pptx");
        const buffer = await generatePowerPoint(args);
        return writeArtifact(rootDir, target, buffer);
      },
    }),
  ];
}
