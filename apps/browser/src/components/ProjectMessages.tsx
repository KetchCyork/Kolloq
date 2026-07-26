import { StepTracker } from "@newvector/ui";
import { useEffect, useRef } from "react";
import { attachmentDataUrl } from "../attachments";
import type { LiveTurn } from "../store";
import { useStore } from "../store";
import type { Project } from "../types";
import { formatTime } from "../utils";

export function ProjectMessages({ project, live }: { project: Project; live?: LiveTurn }) {
  const { accounts, setCurrentView } = useStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [project.messages.length, live?.text]);

  if (project.messages.length === 0 && !live) {
    return (
      <div className="messages">
        <div className="empty-state">
          Message the project to get started — mention an agent by name (e.g. "@Atlas") to direct it, or leave the
          picker on Auto.
        </div>
      </div>
    );
  }

  return (
    <div className="messages">
      {project.messages.map((message) => {
        const member = project.roster.find((candidate) => candidate.id === message.memberId);
        const account = member ? accounts.find((candidate) => candidate.id === member.accountId) : undefined;
        return (
          <div className={`message role-${message.role}`} key={message.id}>
            <div>
              {message.error ? (
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
              ) : (
                <>
                  {member && <div className="message-meta">{member.identity.name}{account ? ` · ${account.model}` : ""}</div>}
                  {message.content && <div className="bubble">{message.content}</div>}
                </>
              )}
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
      })}

      {live && (
        <div className="message role-assistant">
          <StepTracker text={live.text} error={live.error} toolCalls={[]} />
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
