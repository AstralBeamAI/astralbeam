import { ArrowUpRightIcon, CalendarBlankIcon, FolderSimpleIcon } from "@phosphor-icons/react"
import { Avatar } from "./issue-bits.tsx"
import type { Workspace } from "@/lib/model.ts"

export function ProjectCards({
  workspace,
  onSelect,
}: {
  workspace: Workspace
  onSelect: (id: string) => void
}) {
  return (
    <div className="project-grid">
      {workspace.projects.map((project) => {
        const issues = workspace.issues.filter((issue) => issue.projectId === project.id)
        const done = issues.filter((issue) => issue.status === "Done").length
        const progress = issues.length ? Math.round((done / issues.length) * 100) : 0
        return (
          <button
            type="button"
            key={project.id}
            className="project-card"
            onClick={() => onSelect(project.id)}
          >
            <span className="project-card-top">
              <span className={`project-icon ${project.color}`}>
                <FolderSimpleIcon size={21} weight="duotone" />
              </span>
              <span className="project-health">
                <i />
                On track
              </span>
              <ArrowUpRightIcon className="project-arrow" size={16} />
            </span>
            <h3>{project.name}</h3>
            <p>{project.description}</p>
            <span className="project-progress-label">
              <span>
                {done} of {issues.length} issues
              </span>
              <strong>{progress}%</strong>
            </span>
            <span className="progress-track">
              <span className={project.color} style={{ width: `${progress}%` }} />
            </span>
            <span className="project-card-bottom">
              <span>
                <CalendarBlankIcon size={14} />
                {project.target}
              </span>
              <Avatar
                member={workspace.members.find((member) => member.id === project.leadId)}
                small
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}
