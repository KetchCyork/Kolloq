import type { FileArtifact } from "@newvector/core";
import { attachmentDataUrl } from "../attachments";
import { alertDialog } from "../dialogs";
import { artifactFilename, canDownloadArtifact, downloadFileArtifact, formatBytes } from "../fileArtifact";
import { useStore } from "../store";
import type { StoredMessage } from "../types";
import { formatTime } from "../utils";

/** What, if anything, a stored message contributes to the visible transcript. */
export type MessageDisplayKind = "error" | "artifact-only" | "content" | "hidden";

/**
 * Decides how a stored message renders. Intermediate tool activity — `role: "tool"` results and
 * assistant turns that only invoked tools — is suppressed ("hidden") so the transcript reads as the
 * user's questions and the assistant's answers rather than a dump of every call. The full history
 * still lives in `session.messages` and is re-sent to the model; this only affects display. A tool
 * result carrying a downloadable artifact is a real deliverable, so it survives as "artifact-only".
 */
export function messageDisplayKind(message: StoredMessage): MessageDisplayKind {
  if (message.error) return "error";
  if (message.role === "tool") return message.artifact ? "artifact-only" : "hidden";
  if (!message.content && !message.attachments?.length) return "hidden";
  return "content";
}

function ArtifactDownload({ artifact, sessionId }: { artifact: FileArtifact; sessionId: string }) {
  const filename = artifactFilename(artifact);
  async function handleDownload() {
    try {
      await downloadFileArtifact(artifact, sessionId);
    } catch (error) {
      await alertDialog(error instanceof Error ? error.message : String(error));
    }
  }
  return (
    <div className="artifact-download">
      <span className="artifact-icon">📄</span>
      <span className="artifact-name" title={artifact.path}>
        {filename}
      </span>
      <span className="artifact-size">{formatBytes(artifact.bytesWritten)}</span>
      <button onClick={handleDownload} disabled={!canDownloadArtifact(artifact)}>
        Download
      </button>
    </div>
  );
}

export function MessageItem({ message, sessionId }: { message: StoredMessage; sessionId: string }) {
  const { setCurrentView } = useStore();
  const kind = messageDisplayKind(message);

  if (kind === "hidden") return null;

  if (kind === "error" && message.error) {
    return (
      <div className={`message role-${message.role}`}>
        <div>
          <div className="bubble message-error-bubble">
            <div className="message-error-head">
              <span aria-hidden="true">⚠️</span>
              <span>Turn failed</span>
            </div>
            <div className="message-error-reason">{message.error.reason}</div>
            {message.error.isConfigIssue && (
              <button type="button" className="link-button" onClick={() => setCurrentView("settings")}>
                Manage Accounts
              </button>
            )}
          </div>
          <div className="message-meta">{formatTime(message.createdAt)}</div>
        </div>
      </div>
    );
  }

  if (kind === "artifact-only" && message.artifact) {
    return (
      <div className="message role-tool">
        <div className="tool-card">
          <ArtifactDownload artifact={message.artifact} sessionId={sessionId} />
        </div>
      </div>
    );
  }

  return (
    <div className={`message role-${message.role}`}>
      <div>
        {message.content && <div className="bubble">{message.content}</div>}
        {message.attachments?.length ? (
          <div className="attachment-chips">
            {message.attachments.map((attachment) =>
              attachment.kind === "image" ? (
                <img
                  key={attachment.id}
                  className="attachment-thumb"
                  src={attachmentDataUrl(attachment)}
                  alt={attachment.name}
                  title={attachment.name}
                />
              ) : (
                <span className="attachment-chip" key={attachment.id}>
                  📄 {attachment.name}
                </span>
              ),
            )}
          </div>
        ) : null}
        <div className="message-meta">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}
