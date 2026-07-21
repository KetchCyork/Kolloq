import { attachmentDataUrl } from "../attachments";
import { useStore } from "../store";
import type { StoredMessage } from "../types";
import { formatTime } from "../utils";

export function MessageItem({ message }: { message: StoredMessage }) {
  const { openAccountsManager } = useStore();

  if (message.error) {
    return (
      <div className="message role-assistant">
        <div>
          <div className="bubble message-error-bubble">
            <div className="message-error-head">
              <span aria-hidden="true">⚠️</span>
              <span>Turn failed</span>
            </div>
            <div className="message-error-reason">{message.error.reason}</div>
            {message.error.raw !== message.error.reason && (
              <div className="message-error-raw">{message.error.raw}</div>
            )}
            {message.error.isConfigIssue && (
              <button type="button" className="settings-btn message-error-action" onClick={openAccountsManager}>
                Manage Accounts →
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
