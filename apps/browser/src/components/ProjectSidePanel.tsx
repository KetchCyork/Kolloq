import { useStore } from "../store";
import type { Project } from "../types";
import { ProjectFiles } from "./ProjectFiles";
import { ProjectRoster } from "./ProjectRoster";
import { ProjectTasks } from "./ProjectTasks";

export function ProjectSidePanel({ project }: { project: Project }) {
  const { updateProject } = useStore();

  return (
    <aside className="project-side">
      <ProjectRoster project={project} />
      <ProjectTasks project={project} />
      <ProjectFiles project={project} />
      <div className="proj-h">Project instructions</div>
      <textarea
        className="project-instructions"
        placeholder="Persistent guidance every agent in this project sees, e.g. tone, conventions, constraints…"
        value={project.instructions}
        onChange={(event) => updateProject(project.id, { instructions: event.target.value })}
      />
    </aside>
  );
}
