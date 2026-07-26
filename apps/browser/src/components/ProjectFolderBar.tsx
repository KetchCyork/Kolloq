import { useState } from "react";
import { confirmDialog } from "../dialogs";
import { isFolderAccessSupported } from "../projectFolder";
import { useStore } from "../store";
import type { Project } from "../types";

/** Working-folder bar (spec §4): explicit connect/change/disconnect, the path always visible,
 * and a warning before switching folders since agents lose access to the old one immediately. */
export function ProjectFolderBar({ project }: { project: Project }) {
  const { connectProjectFolder, disconnectProjectFolder } = useStore();
  const [busy, setBusy] = useState(false);

  if (!isFolderAccessSupported()) {
    return (
      <div className="folder-bar">
        <span className="lbl">📁 Working folder</span>
        <span className="badge gray">Not available in this browser</span>
        <span className="hint" style={{ margin: 0 }}>
          Use Chrome, Edge, or the desktop app for folder access — knowledge files below still work here.
        </span>
      </div>
    );
  }

  async function handleConnect() {
    if (project.workingFolder) {
      const confirmed = await confirmDialog(
        `Change the working folder? Agents in "${project.identity.name}" will lose access to "${project.workingFolder.name}" immediately.`,
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      await connectProjectFolder(project.id);
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!project.workingFolder) return;
    const confirmed = await confirmDialog({
      message: `Disconnect "${project.workingFolder.name}"? Agents will lose access immediately.`,
      confirmLabel: "Disconnect",
      danger: true,
    });
    if (confirmed) disconnectProjectFolder(project.id);
  }

  if (!project.workingFolder) {
    return (
      <div className="folder-bar">
        <span className="lbl">📁 Working folder</span>
        <span className="hint" style={{ margin: 0 }}>
          Not connected — agents can only use uploaded knowledge files.
        </span>
        <button className="btn small" onClick={() => void handleConnect()} disabled={busy}>
          {busy ? "Connecting…" : "Connect folder"}
        </button>
      </div>
    );
  }

  return (
    <div className="folder-bar">
      <span className="lbl">📁 Working folder</span>
      <code title="Browsers only expose the folder's own name, not its full path.">{project.workingFolder.name}</code>
      <span className="badge green">Read & write</span>
      <button className="btn small" onClick={() => void handleConnect()} disabled={busy}>
        Change
      </button>
      <button className="btn small" onClick={handleDisconnect} disabled={busy}>
        Disconnect
      </button>
    </div>
  );
}
