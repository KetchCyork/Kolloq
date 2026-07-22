import { useEffect, useRef, useState } from "react";
import { loadProjectFolderHandle } from "../db";
import { attachmentDataUrl } from "../attachments";
import { listFolderEntries, verifyFolderPermission, type FolderEntry } from "../projectFolder";
import { useStore } from "../store";
import type { Project } from "../types";

/** Live-lists the connected working folder's top-level contents plus the project's uploaded
 * knowledge files. Folder contents aren't persisted — they're re-read from the handle each time
 * this mounts, since the folder is the source of truth and may have changed on disk. */
export function ProjectFiles({ project }: { project: Project }) {
  const { addProjectKnowledgeFiles, removeProjectKnowledgeFile } = useStore();
  const [folderEntries, setFolderEntries] = useState<FolderEntry[] | null>(null);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setFolderEntries(null);
    setNeedsReconnect(false);
    if (!project.workingFolder) return;

    void (async () => {
      const handle = (await loadProjectFolderHandle(project.id)) as FileSystemDirectoryHandle | undefined;
      if (!handle || cancelled) return;
      const permission = await verifyFolderPermission(handle, false);
      if (permission !== "granted") {
        if (!cancelled) setNeedsReconnect(true);
        return;
      }
      const entries = await listFolderEntries(handle);
      if (!cancelled) setFolderEntries(entries);
    })();

    return () => {
      cancelled = true;
    };
  }, [project.id, project.workingFolder]);

  async function handleReconnect() {
    const handle = (await loadProjectFolderHandle(project.id)) as FileSystemDirectoryHandle | undefined;
    if (!handle) return;
    const permission = await verifyFolderPermission(handle, true);
    if (permission !== "granted") return;
    setNeedsReconnect(false);
    setFolderEntries(await listFolderEntries(handle));
  }

  return (
    <>
      <div className="proj-h">Files</div>
      {project.workingFolder && needsReconnect && (
        <button type="button" className="btn small" onClick={() => void handleReconnect()}>
          Re-grant folder access to list files
        </button>
      )}
      {project.workingFolder &&
        !needsReconnect &&
        folderEntries?.map((entry) => (
          <div className="file-row" key={entry.name}>
            <span className="file-ico">{entry.kind === "directory" ? "📁" : "📄"}</span>
            {entry.name}
            {entry.kind === "directory" ? "/" : ""}
          </div>
        ))}
      {project.knowledgeFiles.map((file) => (
        <div className="file-row" key={file.id}>
          <span className="file-ico">{file.kind === "image" ? "🖼" : "📄"}</span>
          {file.kind === "image" ? (
            <img className="attachment-thumb" src={attachmentDataUrl(file)} alt={file.name} title={file.name} />
          ) : (
            file.name
          )}
          <span className="badge gray" style={{ marginLeft: "auto" }}>
            knowledge
          </span>
          <button type="button" className="task-remove" title="Remove" onClick={() => removeProjectKnowledgeFile(project.id, file.id)}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn small" style={{ marginTop: 4 }} onClick={() => fileInputRef.current?.click()}>
        ＋ Add knowledge file
      </button>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          if (files.length) void addProjectKnowledgeFiles(project.id, files);
          event.target.value = "";
        }}
      />
    </>
  );
}
