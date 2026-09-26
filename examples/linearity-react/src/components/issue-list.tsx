import { MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react"
import { Avatar, PriorityIcon, StatusIcon } from "./issue-bits.tsx"
import { Button } from "./ui/button.tsx"
import { statuses, type Issue, type Workspace } from "@/lib/model.ts"

export function IssueList({
  workspace,
  issues,
  board,
  onOpen,
  onCreate,
}: {
  workspace: Workspace
  issues: Issue[]
  board: boolean
  onOpen: (issue: Issue) => void
  onCreate: (status?: Issue["status"]) => void
}) {
  if (!issues.length)
    return (
      <div className="empty-state">
        <MagnifyingGlassIcon size={32} />
        <h3>A little room for what’s next</h3>
        <p>No issues match this view. Adjust your filters or create an issue.</p>
        <Button type="button" variant="outline" onClick={() => onCreate()}>
          <PlusIcon />
          New issue
        </Button>
      </div>
    )
  return (
    <div className={board ? "issue-board" : "issue-list"}>
      {statuses
        .filter((status) => issues.some((issue) => issue.status === status))
        .map((status) => (
          <section key={status} className="issue-group" aria-label={`${status} issues`}>
            <div className="group-heading">
              <StatusIcon status={status} />
              <h3>{status}</h3>
              <span className="count">
                {issues.filter((issue) => issue.status === status).length}
              </span>
              <span className="spacer" />
              <button
                type="button"
                title="Create issue"
                aria-label={`Create issue in ${status}`}
                onClick={() => onCreate(status)}
              >
                <PlusIcon size={14} />
              </button>
            </div>
            {issues
              .filter((issue) => issue.status === status)
              .map((issue) => {
                const member = workspace.members.find((entry) => entry.id === issue.assigneeId)
                const project = workspace.projects.find((entry) => entry.id === issue.projectId)
                return (
                  <button
                    type="button"
                    key={issue.id}
                    className="issue-row"
                    onClick={() => onOpen(issue)}
                    aria-label={`${workspace.prefix}-${issue.number} ${issue.title}`}
                  >
                    <span className="issue-number">
                      {workspace.prefix}-{issue.number}
                    </span>
                    <PriorityIcon priority={issue.priority} />
                    <span className="issue-name">{issue.title}</span>
                    <span className={`issue-label label-${issue.label.toLowerCase()}`}>
                      <i />
                      {issue.label}
                    </span>
                    <span className="issue-project" title={project?.name}>
                      <i className={`project-dot ${project?.color}`} />
                      {project?.name}
                    </span>
                    <Avatar member={member} small />
                  </button>
                )
              })}
          </section>
        ))}
    </div>
  )
}
