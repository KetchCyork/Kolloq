import type { ChatAttachment } from "@newvector/core";
import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { filesToAttachments } from "../attachments";
import type { ProviderConfig } from "../types";
import { ModelPicker } from "./ModelPicker";

/** Chrome/Edge/Safari support picking a whole folder via this non-standard attribute; Firefox falls back to a normal multi-file picker. */
interface DirectoryInputProps {
  webkitdirectory?: string;
  directory?: string;
}

export function Composer({
  disabled,
  providerConfig,
  onProviderConfigChange,
  onSend,
}: {
  disabled: boolean;
  providerConfig: ProviderConfig;
  onProviderConfigChange: (patch: Partial<ProviderConfig>) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [isDragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: File[]) {
    if (!files.length) return;
    const { attachments: added, rejections } = await filesToAttachments(files);
    setAttachments((prev) => [...prev, ...added]);
    setPendingError(rejections.length ? rejections.map((r) => `${r.name}: ${r.reason}`).join("; ") : null);
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
    setPendingError(null);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void addFiles(Array.from(event.dataTransfer.files));
  }

  const directoryProps: DirectoryInputProps = { webkitdirectory: "", directory: "" };

  return (
    <div
      className={`composer${isDragOver ? " composer-drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((attachment) => (
            <span className="attachment-chip" key={attachment.id}>
              {attachment.kind === "image" ? "🖼️" : "📄"} {attachment.name}
              <button type="button" onClick={() => removeAttachment(attachment.id)} aria-label={`Remove ${attachment.name}`}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {pendingError && <div className="attachment-error">⚠️ {pendingError}</div>}

      <textarea
        placeholder="Message this agent… (Enter to send, Shift+Enter for newline)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="composer-actions">
        <button type="button" title="Attach files or images" onClick={() => fileInputRef.current?.click()}>
          📎
        </button>
        <button type="button" title="Attach a folder" onClick={() => folderInputRef.current?.click()}>
          📁
        </button>
        <ModelPicker providerConfig={providerConfig} onChange={onProviderConfigChange} />
        <div className="composer-toolbar-spacer" />
        <button className="send-btn" onClick={submit} disabled={disabled || (!text.trim() && attachments.length === 0)}>
          Send
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        hidden
        {...directoryProps}
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </div>
  );
}
