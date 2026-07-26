#!/usr/bin/env node
/**
 * Guards the user-visible app name.
 *
 * The display name has drifted back to "New Vector Cowork" more than once
 * (see NEW-107), because it lives in eight unrelated files — a Tauri config,
 * three Rust source files, an HTML title, a React component, a workflow, and
 * package.json — so a rename that misses one still builds and still ships.
 * This check makes that miss a CI failure instead of a screenshot.
 *
 * "New Vector AI" is the company and stays. "Open Work" is the product.
 * Internal identifiers (bundle id `ai.newvector.cowork`, keychain service,
 * crate names, IndexedDB name, storage keys, session export format) are
 * deliberately NOT covered here — renaming those would orphan credentials and
 * local data on existing installs.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const APP_NAME = "Open Work";

/** Every site that renders the app name to a user. */
const DISPLAY_NAME_SITES = [
  { file: "apps/desktop/src-tauri/tauri.conf.json", must: `"productName": "${APP_NAME}"`, what: "macOS .app bundle name / Spotlight" },
  { file: "apps/desktop/src-tauri/tauri.conf.json", must: `"title": "${APP_NAME}"`, what: "desktop window title bar" },
  { file: "apps/desktop/src-tauri/src/menu.rs", must: `let app_name = "${APP_NAME}";`, what: "native macOS menu bar" },
  { file: "apps/desktop/src-tauri/src/tray.rs", must: `"Show ${APP_NAME}"`, what: "system tray menu item" },
  { file: "apps/desktop/src-tauri/Cargo.toml", must: `description = "${APP_NAME} desktop shell"`, what: "crate description" },
  { file: "apps/browser/index.html", must: `<title>${APP_NAME}</title>`, what: "browser tab title" },
  { file: "apps/browser/src/components/Sidebar.tsx", must: `>${APP_NAME}<`, what: "in-app sidebar brand" },
  { file: "package.json", must: `"name": "open-work"`, what: "workspace package name" },
];

/**
 * Names that must never reach a user again. Matched across the whole repo,
 * minus the paths below, so a new file reintroducing one is caught too.
 */
const FORBIDDEN = ["New Vector Cowork", "OpenWork", "Open-Work app", "NewVector Cowork"];

const SEARCH_EXTENSIONS = [".json", ".ts", ".tsx", ".js", ".mjs", ".rs", ".html", ".toml", ".yml", ".yaml", ".css", ".md"];

/** Internal identifiers and history that legitimately keep the old spelling. */
const EXEMPT_PATH_PARTS = [
  "node_modules",
  "src-tauri/target",
  "Cargo.lock",
  "pnpm-lock.yaml",
  "/dist/",
  "/.git/",
  "scripts/check-app-name.mjs",
  "CHANGELOG.md",
];

const EXEMPT_LINE_PATTERNS = [
  /github\.com\/KetchCyork\/Open-Work/, // the repo slug, not the app name
  /Open-Work\.git/,
  /OpenWork-QA-Builds/, // qa-build.sh's literal DEST_DIR folder name, not a display rename of "Open Work"
];

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
}

const failures = [];

// 1. Every display site says exactly "Open Work".
for (const site of DISPLAY_NAME_SITES) {
  let contents;
  try {
    contents = readFileSync(join(REPO_ROOT, site.file), "utf8");
  } catch {
    failures.push(`${site.file}: missing — expected it to set the app name for ${site.what}`);
    continue;
  }
  if (!contents.includes(site.must)) {
    failures.push(`${site.file}: ${site.what} does not say "${APP_NAME}"\n    expected to find: ${site.must}`);
  }
}

// 2. No forbidden spelling anywhere a user could see it.
for (const relPath of trackedFiles()) {
  if (EXEMPT_PATH_PARTS.some((part) => relPath.includes(part.replace(/^\/|\/$/g, "")))) continue;
  if (!SEARCH_EXTENSIONS.some((ext) => relPath.endsWith(ext))) continue;

  let contents;
  try {
    contents = readFileSync(join(REPO_ROOT, relPath), "utf8");
  } catch {
    continue;
  }

  contents.split("\n").forEach((line, index) => {
    if (EXEMPT_LINE_PATTERNS.some((pattern) => pattern.test(line))) return;
    for (const banned of FORBIDDEN) {
      if (line.includes(banned)) {
        failures.push(`${relPath}:${index + 1}: uses "${banned}" — the app is called "${APP_NAME}"\n    ${line.trim()}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error(`App name check failed — the product is "${APP_NAME}" (the company is "New Vector AI").\n`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  console.error(`\n${failures.length} problem(s). Fix the names above, or update scripts/check-app-name.mjs if the product was deliberately renamed.`);
  process.exit(1);
}

console.log(`App name check passed — "${APP_NAME}" is consistent across ${DISPLAY_NAME_SITES.length} display sites.`);
