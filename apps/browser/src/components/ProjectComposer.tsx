import { useRef, useState, type KeyboardEvent } from "react";
import { filesToAttachments } from "../attachments";
import { AUTO_ROUTE } from "../projectRouting";
import type { ChatAttachment } from "../types";

export function ProjectComposer({
  disabled,
  rosterEmpty,
  memberNames,
  pickedMemberId,
  onPickedMemberChange,
  onSend,
}: {
  disabled: boolean;
  rosterEmpty: boolean;
  memberNames: Array<{ id: string; name: string }>;
  pickedMemberId: string;
  onPickedMemberChange: (id: string) => void;
  onSend: (text: string, attachments: ChatAttachment[]) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function submit() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || disabled || rosterEmpty) return;
    onSend(trimmed, attachments);
    setText("");
    setAttachments([]);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="attachment-chips">
          {attachments.map((attachment) => (
            <span className="attachment-chip" key={attachment.id}>
              {attachment.kind === "image" ? "🖼️" : "📄"} {attachment.name}
              <button
                type="button"
                onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
                aria-label={`Remove ${attachment.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <textarea
        placeholder={rosterEmpty ? "Add an agent to the roster to start chatting…" : "Message the project — @agent to direct it…"}
        value={text}
        disabled={rosterEmpty}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <div className="composer-actions">
        <select
          aria-label="Route to"
          className="project-agent-picker"
          value={pickedMemberId}
          disabled={rosterEmpty}
          onChange={(event) => onPickedMemberChange(event.target.value)}
        >
          <option value={AUTO_ROUTE}>Auto-route</option>
          {memberNames.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <button type="button" title="Attach files or images" onClick={() => fileInputRef.current?.click()} disabled={rosterEmpty}>
          📎
        </button>
        <div className="composer-toolbar-spacer" />
        <button
          className="send-btn"
          onClick={submit}
          disabled={disabled || rosterEmpty || (!text.trim() && attachments.length === 0)}
        >
          Send
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        onChange={async (event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (!files.length) return;
          const { attachments: added } = await filesToAttachments(files);
          setAttachments((prev) => [...prev, ...added]);
        }}
      />
    </div>
  );
}
