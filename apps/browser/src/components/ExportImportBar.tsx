import { useRef } from "react";
import { alertDialog, confirmDialog } from "../dialogs";
import { useStore } from "../store";
import type { SessionExportFile } from "../types";

export function ExportImportBar() {
  const { exportSessions, importSessions } = useStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    const data = exportSessions();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `newvector-cowork-sessions-${new Date(data.exportedAt).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    const text = await file.text();
    let parsed: SessionExportFile;
    try {
      parsed = JSON.parse(text);
    } catch {
      await alertDialog("That file isn't valid JSON.");
      return;
    }
    const merge = await confirmDialog({
      title: "Import sessions",
      message:
        "Merge keeps your existing sessions (same-id sessions are overwritten).\nReplace discards all local sessions and imports only this file.",
      confirmLabel: "Merge",
      cancelLabel: "Replace all",
    });
    try {
      await importSessions(parsed, merge ? "merge" : "replace");
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="sidebar-io-bar">
      <button onClick={handleExport}>Export JSON</button>
      <button onClick={() => fileInputRef.current?.click()}>Import JSON</button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json"
        style={{ display: "none" }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleImportFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
