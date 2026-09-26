import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import {
  ArrowRightIcon,
  ChartDonutIcon,
  CheckCircleIcon,
  CommandIcon,
  FolderSimpleIcon,
  KanbanIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  StarFourIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Button } from "./ui/button.tsx"
import { Badge } from "./ui/badge.tsx"
import { IssueList } from "./issue-list.tsx"
import { ProjectCards } from "./project-cards.tsx"
import { Avatar } from "./issue-bits.tsx"
import type { View } from "./sidebar.tsx"
import { priorities, statuses } from "@/lib/model.ts"
import { useWorkspace } from "@/lib/use-workspace.ts"
import { searchSchema, workspaceUrl } from "@/lib/navigation.ts"

export function WorkspaceView({ view }: { view: View }) {
  const workspace = useWorkspace()
  const params = useParams({ strict: false })
  const search = useSearch({ from: "/$workspaceId" })
  const route = useNavigate()
  const {
    q: query = "",
    status = "",
    priority = "",
    scope = "All issues",
    assigneeId: memberId = "",
    cycle = "Cycle 24",
  } = search
  const projectId = params.projectId ?? ""
  const board = search.layout === "board"
  const navigate = (next: View) =>
    void route({ href: workspaceUrl(workspace.id, next.toLowerCase()) })
  const selectProject = (id: string) =>
    void route({ href: workspaceUrl(workspace.id, `projects/${id}`) })
  const setQuery = (q: string) =>
    void route({
      to: ".",
      search: (old) => searchSchema.parse({ ...old, q: q || undefined }),
      replace: true,
    })
  const setStatus = (status: string) =>
    void route({
      to: ".",
      search: (old) => searchSchema.parse({ ...old, status: status || undefined }),
      replace: true,
    })
  const setPriority = (priority: string) =>
    void route({
      to: ".",
      search: (old) => searchSchema.parse({ ...old, priority: priority || undefined }),
      replace: true,
    })
  const setScope = (scope: string) =>
    void route({ to: ".", search: (old) => searchSchema.parse({ ...old, scope }), replace: true })
  const setBoard = (board: boolean) =>
    void route({
      to: ".",
      search: (old) => searchSchema.parse({ ...old, layout: board ? "board" : "list" }),
      replace: true,
    })
  const setCycle = (cycle: string) =>
    void route({ to: ".", search: (old) => searchSchema.parse({ ...old, cycle }), replace: true })
  const project = workspace.projects.find((entry) => entry.id === projectId)
  if (projectId && !project)
    return (
      <div className="empty-state">
        <h1>Project not found</h1>
        <p>This project is not in the current workspace.</p>
        <Button onClick={() => navigate("Projects")}>Back to projects</Button>
      </div>
    )
  const selectedMember = workspace.members.find((entry) => entry.id === memberId)
  const active = workspace.issues.filter(
    (issue) => issue.status !== "Done" && issue.status !== "Canceled",
  )
  const cycleIssues = workspace.issues.filter((issue) => issue.cycle === "Cycle 24")
  const done = cycleIssues.filter((issue) => issue.status === "Done").length
  const progress = Math.round((done / Math.max(1, cycleIssues.length)) * 100)
  const issues = workspace.issues.filter(
    (issue) =>
      (!query ||
        `${issue.title} ${workspace.prefix}-${issue.number}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!status || issue.status === status) &&
      (!priority || issue.priority === priority) &&
      (!projectId || issue.projectId === projectId) &&
      (!memberId || issue.assigneeId === memberId) &&
      (scope !== "My issues" || issue.assigneeId === workspace.members[0]!.id) &&
      (scope !== "Active cycle" || issue.cycle === "Cycle 24") &&
      (view !== "Cycles" || issue.cycle === cycle),
  )
  const title =
    project?.name ??
    (selectedMember
      ? `${selectedMember.name}'s issues`
      : view === "Overview"
        ? "Workspace overview"
        : view === "Issues"
          ? "All issues"
          : view === "Cycles"
            ? cycle
            : view)
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {view === "Overview" ? "WORKSPACE" : `${workspace.name.toUpperCase()} WORKSPACE`}
          </div>
          <h1>{title}</h1>
          <p>
            {project?.description ??
              (view === "Overview"
                ? workspace.tagline
                : view === "Projects"
                  ? "Progress, owners, and upcoming milestones."
                  : view === "Team"
                    ? "People and their active work."
                    : view === "Activity"
                      ? "Every move, from your team and Astro."
                      : "Keep the important work moving.")}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void route({ href: workspaceUrl(workspace.id, "issues/new") })}
        >
          <PlusIcon />
          New issue
        </Button>
      </div>
      {view === "Overview" && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <span>
                Active issues
                <CheckCircleIcon size={17} />
              </span>
              <strong>
                {active.length}
                <small>across your workspace</small>
              </strong>
              <span className="stat-note">
                {
                  active.filter((issue) => issue.priority === "High" || issue.priority === "Urgent")
                    .length
                }{" "}
                high priority
              </span>
            </div>
            <div className="stat-card">
              <span>
                Projects in motion
                <FolderSimpleIcon size={17} />
              </span>
              <strong>
                {workspace.projects.length}
                <small>moving toward the next milestone</small>
              </strong>
              <span className="stat-note sage-text">Let’s keep the momentum</span>
            </div>
            <div className="stat-card">
              <span>
                Cycle completion
                <ChartDonutIcon size={17} />
              </span>
              <strong>
                {progress}
                <b>%</b>
                <small>
                  {done} of {cycleIssues.length} issues shipped
                </small>
              </strong>
              <span className="mini-progress">
                {Array.from({ length: 24 }, (_, i) => (
                  <i key={i} className={i < Math.round((progress * 24) / 100) ? "filled" : ""} />
                ))}
              </span>
            </div>
          </div>
          <div className="section-heading">
            <h2>Projects in motion</h2>
            <button type="button" onClick={() => navigate("Projects")}>
              View all projects
              <ArrowRightIcon size={14} />
            </button>
          </div>
          <ProjectCards workspace={workspace} onSelect={selectProject} />
          <div className="cycle-banner">
            <span className="cycle-icon">
              <ChartDonutIcon size={22} />
            </span>
            <div>
              <strong>
                Cycle 24 <Badge variant="secondary">Current</Badge>
              </strong>
              <p>Sep 21 – Oct 4 · A focused fortnight of forward motion</p>
            </div>
            <span className="spacer" />
            <span className="cycle-percent">{progress}% complete</span>
            <button
              type="button"
              aria-label="View current cycle"
              onClick={() => navigate("Cycles")}
            >
              <ArrowRightIcon size={17} />
            </button>
          </div>
        </>
      )}
      {view === "Projects" && <ProjectCards workspace={workspace} onSelect={selectProject} />}
      {view === "Team" && (
        <div className="team-grid">
          {workspace.members.map((member) => (
            <button
              type="button"
              className="team-card"
              key={member.id}
              onClick={() => {
                void route({
                  href: `${workspaceUrl(workspace.id, "issues")}?assigneeId=${member.id}`,
                })
              }}
            >
              <Avatar member={member} />
              <h3>{member.name}</h3>
              <p>{member.role}</p>
              <span>
                {
                  workspace.issues.filter(
                    (issue) =>
                      issue.assigneeId === member.id &&
                      issue.status !== "Done" &&
                      issue.status !== "Canceled",
                  ).length
                }{" "}
                open issues
                <ArrowRightIcon size={15} />
              </span>
            </button>
          ))}
        </div>
      )}
      {view === "Activity" && (
        <div className="activity-list">
          {workspace.activity.map((activity) => (
            <div key={activity.id}>
              <span
                className={`activity-icon ${activity.actor === "Astro" ? "purple" : "neutral"}`}
              >
                {activity.actor === "Astro" ? (
                  <StarFourIcon size={17} />
                ) : (
                  <CheckCircleIcon size={17} />
                )}
              </span>
              <div>
                <strong>{activity.actor}</strong>
                <p>{activity.text}</p>
              </div>
              <time dateTime={activity.at}>
                {new Date(activity.at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
        </div>
      )}
      {view === "Cycles" && (
        <div className="cycle-summary">
          <div className="cycle-switch">
            {["Cycle 24", "Cycle 25", "No cycle"].map((entry) => (
              <Button
                key={entry}
                type="button"
                variant={cycle === entry ? "secondary" : "ghost"}
                onClick={() => setCycle(entry)}
              >
                {entry}
              </Button>
            ))}
          </div>
          <p>
            {issues.filter((issue) => issue.status === "Done").length} of {issues.length} issues
            completed <span>·</span>{" "}
            {cycle === "Cycle 24"
              ? "Sep 21 – Oct 4"
              : cycle === "Cycle 25"
                ? "Oct 5 – Oct 18"
                : "Not scheduled"}
          </p>
        </div>
      )}
      {["Issues", "Cycles"].includes(view) && (
        <section className="issues-section">
          <div className="section-heading">
            <h2>
              Issues
              <span className="count">{issues.length}</span>
            </h2>
            <div className="view-switch" aria-label="Issue layout">
              <button
                type="button"
                aria-label="List view"
                aria-pressed={!board}
                className={!board ? "selected" : ""}
                onClick={() => setBoard(false)}
              >
                <ListIcon size={16} />
              </button>
              <button
                type="button"
                aria-label="Board view"
                aria-pressed={board}
                className={board ? "selected" : ""}
                onClick={() => setBoard(true)}
              >
                <KanbanIcon size={16} />
              </button>
            </div>
          </div>
          <div className="issue-toolbar">
            <div className="scope-tabs">
              {["All issues", "My issues", "Active cycle"].map((item) => (
                <button
                  type="button"
                  key={item}
                  className={scope === item ? "selected" : ""}
                  onClick={() => setScope(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <label className="search-box">
              <MagnifyingGlassIcon size={15} />
              <input
                aria-label="Search issues"
                placeholder="Search issues…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="filters">
            <SlidersHorizontalIcon size={14} />
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
            <select
              aria-label="Filter by priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              <option value="">All priorities</option>
              {priorities.map((entry) => (
                <option key={entry}>{entry}</option>
              ))}
            </select>
            {(query || status || priority || scope !== "All issues") && (
              <button
                type="button"
                onClick={() => {
                  void route({ to: ".", search: {}, replace: true })
                }}
              >
                Clear filters
                <XIcon size={12} />
              </button>
            )}
            <span className="spacer" />
            <span className="issue-hint"></span>
          </div>
          <IssueList
            workspace={workspace}
            issues={issues}
            board={board}
            onOpen={(issue) =>
              void route({ href: workspaceUrl(workspace.id, `issues/${issue.id}`) })
            }
            onCreate={(status = "Todo") => {
              void route({
                href: `${workspaceUrl(workspace.id, "issues/new")}?status=${encodeURIComponent(status)}`,
              })
            }}
          />
        </section>
      )}
      <footer className="workspace-footer">
        <span>
          <CommandIcon size={13} />
          Your team’s work, in one place.
        </span>
        <span>Linearity playground · Powered by AstralBeam</span>
      </footer>
    </>
  )
}
