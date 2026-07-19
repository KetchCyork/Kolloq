import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOfficeTools } from "./office.js";

/** All Office Open XML files are ZIP archives, so a valid one starts with the "PK" local-file header. */
async function expectZipFile(rootDir: string, relPath: string) {
  const bytes = await fs.readFile(path.join(rootDir, relPath));
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  return bytes;
}

function toolsByName(rootDir: string) {
  return Object.fromEntries(createOfficeTools(rootDir).map((t) => [t.name, t]));
}

describe("createOfficeTools", () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-office-test-"));
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it("exposes the three document generators", () => {
    expect(Object.keys(toolsByName(rootDir)).sort()).toEqual([
      "generate_excel_spreadsheet",
      "generate_powerpoint_presentation",
      "generate_word_document",
    ]);
  });

  it("generates a valid .docx from headings, paragraphs, and bullets", async () => {
    const tool = toolsByName(rootDir).generate_word_document;
    const result = (await tool.execute({
      path: "report",
      title: "Quarterly Report",
      blocks: [
        { type: "heading", text: "Summary", level: 1 },
        { type: "paragraph", text: "Revenue grew this quarter." },
        { type: "bullets", items: ["North: up 10%", "South: flat"] },
      ],
    })) as { path: string; bytesWritten: number };

    expect(result.path).toBe("report.docx");
    expect(result.bytesWritten).toBeGreaterThan(0);
    await expectZipFile(rootDir, "report.docx");
  });

  it("generates a valid multi-sheet .xlsx with header rows", async () => {
    const tool = toolsByName(rootDir).generate_excel_spreadsheet;
    const result = (await tool.execute({
      path: "data.xlsx",
      sheets: [
        { name: "Sales", columns: ["Region", "Revenue"], rows: [["North", 100], ["South", 80]] },
        { name: "Notes", rows: [["Draft"]] },
      ],
    })) as { path: string; bytesWritten: number };

    expect(result.path).toBe("data.xlsx");
    await expectZipFile(rootDir, "data.xlsx");
  });

  it("generates a valid .pptx from slides", async () => {
    const tool = toolsByName(rootDir).generate_powerpoint_presentation;
    const result = (await tool.execute({
      path: "deck",
      title: "Kickoff",
      slides: [
        { title: "Agenda", bullets: ["Intro", "Plan", "Q&A"] },
        { title: "Details", body: "Free-form notes here." },
      ],
    })) as { path: string; bytesWritten: number };

    expect(result.path).toBe("deck.pptx");
    await expectZipFile(rootDir, "deck.pptx");
  });

  it("creates missing parent directories inside the sandbox", async () => {
    const tool = toolsByName(rootDir).generate_word_document;
    await tool.execute({ path: "out/nested/memo.docx", blocks: [{ type: "paragraph", text: "hi" }] });
    await expectZipFile(rootDir, "out/nested/memo.docx");
  });

  it("rejects an output path that escapes the sandbox root", async () => {
    const tool = toolsByName(rootDir).generate_excel_spreadsheet;
    await expect(
      tool.execute({ path: "../escape.xlsx", sheets: [{ name: "S", rows: [["x"]] }] }),
    ).rejects.toThrow(/escapes/);
  });
});
