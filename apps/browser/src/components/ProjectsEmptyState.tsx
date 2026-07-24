import { useStore } from "../store";

export function ProjectsEmptyState() {
  const { createProject } = useStore();

  return (
    <div className="main">
      <div className="chat-header">
        <span>Projects</span>
      </div>
      <div className="empty-state" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p>
          A project is a shared workspace: a working folder, files, tasks, and a roster of agents that all share the
          same project context.
        </p>
        <button className="sidebar-new-btn" style={{ margin: 0 }} onClick={() => createProject()}>
          <span className="sidebar-new-btn-icon">+</span> New project
        </button>
      </div>
    </div>
  );
}
