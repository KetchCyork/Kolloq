import { useState } from "react";
import { AUTO_ROUTE } from "../projectRouting";
import { useStore } from "../store";
import type { Project } from "../types";
import { ProjectComposer } from "./ProjectComposer";
import { ProjectFolderBar } from "./ProjectFolderBar";
import { ProjectMessages } from "./ProjectMessages";
import { ProjectSidePanel } from "./ProjectSidePanel";

export function ProjectPanel({ project }: { project: Project }) {
  const { updateProject, deleteProject, sendProjectMessage, projectLive } = useStore();
  const [pickedMemberId, setPickedMemberId] = useState(AUTO_ROUTE);

  const live = projectLive[project.id];
  const isStreaming = Boolean(live);
  const rosterEmpty = project.roster.length === 0;

  return (
    <div className="main">
      <div className="chat-header">
        <div className="avatar" style={{ background: project.identity.color }}>
          {project.identity.emoji}
        </div>
        <input
          className="name-input"
          style={{ minWidth: 140 }}
          value={project.identity.name}
          onChange={(event) => updateProject(project.id, { identity: { ...project.identity, name: event.target.value } })}
        />
        <ProjectFolderBar project={project} />
        <button
          className="settings-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => {
            if (window.confirm(`Delete "${project.identity.name}"? This cannot be undone.`)) {
              deleteProject(project.id);
            }
          }}
        >
          Delete
        </button>
      </div>

      <div className="project-layout">
        <ProjectSidePanel project={project} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <ProjectMessages project={project} live={live} />
          <ProjectComposer
            disabled={isStreaming}
            rosterEmpty={rosterEmpty}
            memberNames={project.roster.map((member) => ({ id: member.id, name: member.identity.name }))}
            pickedMemberId={pickedMemberId}
            onPickedMemberChange={setPickedMemberId}
            onSend={(text, attachments) => void sendProjectMessage(project.id, text, pickedMemberId, attachments)}
          />
        </div>
      </div>
    </div>
  );
}
