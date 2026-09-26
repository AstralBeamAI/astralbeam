import {
  ArrowsClockwiseIcon,
  ChartDonutIcon,
  CheckSquareIcon,
  CommandIcon,
  FolderSimpleIcon,
  HouseSimpleIcon,
  PlusIcon,
  UsersIcon,
} from "@phosphor-icons/react"
import { Button } from "./ui/button.tsx"
import { Avatar } from "./issue-bits.tsx"
import { demoStore } from "@/lib/store.ts"
import type { Workspace } from "@/lib/model.ts"

export type View = "Overview" | "Issues" | "Projects" | "Cycles" | "Team" | "Activity"
const navigation = [
  { name: "Overview", icon: HouseSimpleIcon },
  { name: "Issues", icon: CheckSquareIcon },
  { name: "Projects", icon: FolderSimpleIcon },
  { name: "Cycles", icon: ChartDonutIcon },
  { name: "Team", icon: UsersIcon },
  { name: "Activity", icon: ArrowsClockwiseIcon },
] as const
export function Sidebar({
  workspace,
  workspaces,
  view,
  projectId,
  onNavigate,
  onProject,
  onCreate,
  onReset,
}: {
  workspace: Workspace
  workspaces: Workspace[]
  view: View
  projectId: string
  onNavigate: (view: View) => void
  onProject: (id: string) => void
  onCreate: () => void
  onReset: () => void
}) {
  return (
    <aside className="navigation">
      <a href="/" className="wordmark" aria-label="Linearity home">
        <span className="linearity-mark">
          <i />
          <i />
          <i />
        </span>
        linearity<span className="demo-badge">DEMO</span>
      </a>
      <div className="workspace-picker">
        <span className={`workspace-monogram ${workspace.initials === "O" ? "blue" : "purple"}`}>
          {workspace.initials}
        </span>
        <label className="sr-only" htmlFor="workspace">
          Workspace
        </label>
        <select
          id="workspace"
          value={workspace.id}
          onChange={(event) => demoStore.switchWorkspace(event.target.value)}
        >
          {workspaces.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name} workspace
            </option>
          ))}
        </select>
      </div>
      <Button type="button" variant="outline" className="create-sidebar" onClick={onCreate}>
        <PlusIcon />
        Create issue
        <span className="spacer" />
        <kbd>C</kbd>
      </Button>
      <div className="nav-label">Workspace</div>
      <nav aria-label="Workspace navigation">
        {navigation.map(({ name, icon: Icon }) => (
          <button
            type="button"
            key={name}
            className={view === name && !projectId ? "nav-item active" : "nav-item"}
            onClick={() => onNavigate(name)}
            aria-current={view === name && !projectId ? "page" : undefined}
          >
            <Icon size={18} weight={view === name ? "duotone" : "regular"} />
            {name}
            {name === "Issues" && (
              <span className="nav-count">
                {
                  workspace.issues.filter(
                    (issue) => issue.status !== "Done" && issue.status !== "Canceled",
                  ).length
                }
              </span>
            )}
          </button>
        ))}
      </nav>
      <div className="nav-label projects-label">
        Projects<span>{workspace.projects.length}</span>
      </div>
      <nav aria-label="Projects">
        {workspace.projects.map((project) => (
          <button
            type="button"
            key={project.id}
            className={`nav-item project-nav ${projectId === project.id ? "active" : ""}`}
            onClick={() => onProject(project.id)}
          >
            <span className={`project-dot ${project.color}`} />
            {project.name}
          </button>
        ))}
      </nav>
      <div className="nav-bottom">
        <div className="playground-note">
          <span className="playground-symbol">
            <CommandIcon size={16} />
          </span>
          <strong>Your own playground</strong>
          <p>
            Make a move. Ask Astro.
            <br />
            Everything here is yours to try.
          </p>
          <button type="button" onClick={onReset}>
            <ArrowsClockwiseIcon size={14} />
            Reset demo
          </button>
        </div>
        <div className="profile">
          <Avatar member={workspace.members[0]} />
          <span>
            <strong>Avery Chen</strong>
            <small>Demo account</small>
          </span>
          <span className="profile-dot" />
        </div>
      </div>
    </aside>
  )
}
