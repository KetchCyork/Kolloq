import { useState } from "react";
import { cycleTaskStatus, taskStatusLabel } from "../projectRouting";
import { useStore } from "../store";
import type { Project } from "../types";

export function ProjectTasks({ project }: { project: Project }) {
  const { addProjectTask, updateProjectTaskStatus, deleteProjectTask } = useStore();
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");

  function handleAdd() {
    const trimmed = title.trim();
    if (!trimmed) return;
    addProjectTask(project.id, trimmed, assigneeId || undefined);
    setTitle("");
  }

  return (
    <>
      <div className="proj-h">Tasks</div>
      {project.tasks.map((task) => {
        const assignee = project.roster.find((member) => member.id === task.assigneeId);
        return (
          <div className={`task${task.status === "done" ? " done" : ""}`} key={task.id}>
            <button
              type="button"
              className="st"
              title={`Mark as ${taskStatusLabel(cycleTaskStatus(task.status))}`}
              onClick={() => updateProjectTaskStatus(project.id, task.id, cycleTaskStatus(task.status))}
            />
            <div style={{ flex: 1 }}>
              <span>{task.title}</span>
              <small>
                {assignee ? `Assigned to ${assignee.identity.name}` : "Unassigned"} · {taskStatusLabel(task.status)}
              </small>
            </div>
            <button
              type="button"
              className="task-remove"
              title="Delete task"
              onClick={() => deleteProjectTask(project.id, task.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
      <div className="task-add-row">
        <input
          placeholder="New task…"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleAdd();
          }}
        />
        {project.roster.length > 0 && (
          <select aria-label="Assignee" value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>
            <option value="">Unassigned</option>
            {project.roster.map((member) => (
              <option key={member.id} value={member.id}>
                {member.identity.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="btn small" onClick={handleAdd} disabled={!title.trim()}>
          Add
        </button>
      </div>
    </>
  );
}
