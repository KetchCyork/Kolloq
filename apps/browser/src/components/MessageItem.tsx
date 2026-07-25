import type { FileArtifact } from "@newvector/core";
import { attachmentDataUrl } from "../attachments";
import { artifactFilename, canDownloadArtifact, downloadFileArtifact, formatBytes } from "../fileArtifact";
import { useStore } from "../store";
import type { StoredMessage } from "../types";
import { formatTime } from "../utils";

function ArtifactDownload({ artifact, sessionId }: { artifact: FileArtifact; sessionId: string }) {
  const filename = artifactFilename(artifact);
  async function handleDownload() {
    try {
      await downloadFileArtifact(artifact, sessionId);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
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

  if (message.error) {
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

  if (message.role === "tool") {
    return (
      <div className="message role-tool">
        <div className="tool-card">
          <div className="tool-card-head">
            <span>🔧</span>
            <span>{message.name}</span>
            <span className="status-badge done">result</span>
          </div>
          <div className="tool-card-body">{message.content}</div>
          {message.artifact ? <ArtifactDownload artifact={message.artifact} sessionId={sessionId} /> : null}
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
        {message.toolCalls?.map((toolCall) => (
          <div className="tool-card" key={toolCall.id}>
            <div className="tool-card-head">
              <span>🔧</span>
              <span>{toolCall.name}</span>
              <span className="status-badge done">called</span>
            </div>
            <div className="tool-card-body">{JSON.stringify(toolCall.arguments)}</div>
          </div>
        ))}
        <div className="message-meta">{formatTime(message.createdAt)}</div>
      </div>
    </div>
  );
}
