import { useEffect, useState } from "react"
import {
  ArrowRightIcon,
  ArrowsClockwiseIcon,
  ChartDonutIcon,
  CheckCircleIcon,
  CommandIcon,
  FolderSimpleIcon,
  KanbanIcon,
  ListIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  StarFourIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Button } from "./ui/button.tsx"
import { Badge } from "./ui/badge.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog.tsx"
import { Sidebar, type View } from "./sidebar.tsx"
import { IssueList } from "./issue-list.tsx"
import { IssueDialog } from "./issue-dialog.tsx"
import { ProjectCards } from "./project-cards.tsx"
import { Astro } from "./astro.tsx"
import { Avatar } from "./issue-bits.tsx"
import { priorities, statuses, type Issue, type Workspace } from "@/lib/model.ts"
import { demoStore, useDemo } from "@/lib/store.ts"

export function Linearity() {
  const { data, ready, notice, generation } = useDemo()
  const workspace = data.workspaces.find((entry) => entry.id === data.activeWorkspaceId)!
  if (!ready)
    return (
      <div className="app-loading">
        <span className="linearity-mark">
          <i />
          <i />
          <i />
        </span>
        Opening your workspace…
      </div>
    )
  return (
    <WorkspaceApp
      key={`${workspace.id}:${generation}`}
      workspace={workspace}
      workspaces={data.workspaces}
      visitorId={data.visitorId}
      notice={notice}
    />
  )
}
function WorkspaceApp({
  workspace,
  workspaces,
  visitorId,
  notice,
}: {
  workspace: Workspace
  workspaces: Workspace[]
  visitorId: string
  notice: string
}) {
  const [view, setView] = useState<View>("Overview")
  const [projectId, setProjectId] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("")
  const [priority, setPriority] = useState("")
  const [scope, setScope] = useState("All issues")
  const [board, setBoard] = useState(false)
  const [chatOpen, setChatOpen] = useState(() => window.matchMedia("(min-width: 1201px)").matches)
  const [navOpen, setNavOpen] = useState(false)
  const [newStatus, setNewStatus] = useState<Issue["status"]>("Todo")
  const [editing, setEditing] = useState<Issue | "new" | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [memberId, setMemberId] = useState("")
  const [cycle, setCycle] = useState("Cycle 24")
  const navigate = (next: View) => {
    setView(next)
    setProjectId("")
    setMemberId("")
    setScope("All issues")
    setStatus("")
    setPriority("")
    setQuery("")
    setNavOpen(false)
  }
  const selectProject = (id: string) => {
    navigate("Issues")
    setProjectId(id)
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.closest("[data-astralbeam-chat]"))
      )
        return
      if (
        event
          .composedPath()
          .some(
            (element) =>
              element instanceof HTMLElement &&
              (element.isContentEditable || ["INPUT", "TEXTAREA"].includes(element.tagName)),
          )
      )
        return
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "c") {
        setNewStatus("Todo")
        setEditing("new")
      }
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [])
  const project = workspace.projects.find((entry) => entry.id === projectId)
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
    <div className={`app-shell ${chatOpen ? "with-chat" : ""} ${navOpen ? "nav-open" : ""}`}>
      <Sidebar
        workspace={workspace}
        workspaces={workspaces}
        view={view}
        projectId={projectId}
        onNavigate={navigate}
        onProject={selectProject}
        onCreate={() => {
          setNewStatus("Todo")
          setEditing("new")
        }}
        onReset={() => setResetOpen(true)}
      />
      {navOpen && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="nav-toggle"
            aria-label="Toggle navigation"
            onClick={() => setNavOpen(!navOpen)}
          >
            <SidebarSimpleIcon />
          </Button>
          <span className="breadcrumb">
            {workspace.name}
            <span>/</span>
            <strong>{view}</strong>
          </span>
          <span className="spacer" />
          <span className="saved-indicator">
            <i />
            {notice ? "Session only" : "Saved on this browser"}
          </span>
          <Button
            type="button"
            variant={chatOpen ? "secondary" : "outline"}
            className="astro-toggle"
            onClick={() => setChatOpen(!chatOpen)}
            aria-expanded={chatOpen}
          >
            <StarFourIcon weight="fill" />
            Astro
          </Button>
        </header>
        {notice && (
          <p role="status" className="storage-notice">
            {notice}
          </p>
        )}
        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "Overview"
                  ? "A CLEAR VIEW OF WHAT'S NEXT"
                  : `${workspace.name.toUpperCase()} WORKSPACE`}
              </div>
              <h1>{title}</h1>
              <p>
                {project?.description ??
                  (view === "Overview"
                    ? workspace.tagline
                    : view === "Projects"
                      ? "Big ideas, broken down into work that ships."
                      : view === "Team"
                        ? "Good work is a team sport."
                        : view === "Activity"
                          ? "Every move, from your team and Astro."
                          : "Keep the important work moving.")}
              </p>
            </div>
            <Button
              type="button"
              onClick={() => {
                setNewStatus("Todo")
                setEditing("new")
              }}
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
                      active.filter(
                        (issue) => issue.priority === "High" || issue.priority === "Urgent",
                      ).length
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
                      <i
                        key={i}
                        className={i < Math.round((progress * 24) / 100) ? "filled" : ""}
                      />
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
                    navigate("Issues")
                    setMemberId(member.id)
                  }}
                >
                  <Avatar member={member} />
                  <h3>{member.name}</h3>
                  <p>{member.role}</p>
                  <span>
                    {
                      workspace.issues.filter(
                        (issue) => issue.assigneeId === member.id && issue.status !== "Done",
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
          {["Overview", "Issues", "Cycles"].includes(view) && (
            <section className="issues-section">
              <div className="section-heading">
                <h2>
                  {view === "Overview" ? "The work ahead" : "Issues"}
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
                      setQuery("")
                      setStatus("")
                      setPriority("")
                      setScope("All issues")
                    }}
                  >
                    Clear filters
                    <XIcon size={12} />
                  </button>
                )}
                <span className="spacer" />
                <span className="issue-hint">Click an issue to make it yours</span>
              </div>
              <IssueList
                workspace={workspace}
                issues={issues}
                board={board}
                onOpen={setEditing}
                onCreate={(status = "Todo") => {
                  setNewStatus(status)
                  setEditing("new")
                }}
              />
            </section>
          )}
          <footer className="workspace-footer">
            <span>
              <CommandIcon size={13} />
              Built for the way teams move.
            </span>
            <span>Linearity playground · Powered by AstralBeam</span>
          </footer>
        </main>
      </div>
      <aside
        className={`astro-panel ${chatOpen ? "" : "chat-hidden"}`}
        aria-label="Astro assistant"
        inert={!chatOpen}
      >
        <div className="astro-header">
          <span className="astro-avatar">
            <StarFourIcon size={19} weight="fill" />
          </span>
          <div>
            <strong>Astro</strong>
            <span>Your workspace, a little brighter.</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close Astro"
            title="Close Astro"
            onClick={() => setChatOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
        <div className="astro-context">
          <span className="context-dot" />
          <strong>{workspace.name}</strong>
          <span>workspace</span>
          <span className="spacer" />
          <span>{workspace.issues.length} issues</span>
        </div>
        <div className="astro-widget">
          <Astro workspace={workspace} visitorId={visitorId} onOpen={setEditing} />
        </div>
        <div className="astro-footer">
          <SparkleIcon size={12} />
          Powered by{" "}
          <a href="https://astralbeam.ai" target="_blank" rel="noreferrer">
            AstralBeam
          </a>
        </div>
      </aside>
      {editing && (
        <IssueDialog
          key={editing === "new" ? "new" : editing.id}
          workspace={workspace}
          issue={
            editing === "new"
              ? undefined
              : workspace.issues.find((issue) => issue.id === editing.id)
          }
          projectId={projectId}
          initialStatus={newStatus}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <span className="reset-icon">
            <ArrowsClockwiseIcon size={25} />
          </span>
          <DialogTitle>A fresh start?</DialogTitle>
          <DialogDescription>
            Reset both workspaces to the original sample data. Your issue edits and local activity
            will be removed, and Astro will start a new conversation.
          </DialogDescription>
          <div className="dialog-actions">
            <Button type="button" variant="outline" onClick={() => setResetOpen(false)}>
              Keep exploring
            </Button>
            <Button type="button" onClick={() => demoStore.reset()}>
              Reset everything
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
