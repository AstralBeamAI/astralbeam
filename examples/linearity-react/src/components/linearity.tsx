import { useEffect, useState } from "react"
import { Outlet, useLocation, useNavigate, useParams, useRouter } from "@tanstack/react-router"
import {
  ArrowsClockwiseIcon,
  SidebarSimpleIcon,
  SparkleIcon,
  StarFourIcon,
  XIcon,
} from "@phosphor-icons/react"
import { Button } from "./ui/button.tsx"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog.tsx"
import { Sidebar, type View } from "./sidebar.tsx"
import { Astro } from "./astro.tsx"
import { demoWorkspaces, type Workspace } from "@/lib/model.ts"
import { demoStore, useDemo } from "@/lib/store.ts"
import { workspaceUrl } from "@/lib/navigation.ts"

export function Linearity() {
  const { data, ready, notice, generation } = useDemo()
  const { workspaceId } = useParams({ from: "/$workspaceId" })
  useEffect(() => {
    if (ready && data.activeWorkspaceId !== workspaceId) demoStore.switchWorkspace(workspaceId)
  }, [ready, workspaceId, data.activeWorkspaceId])
  const workspace = data.workspaces.find((entry) => entry.id === workspaceId)!
  if (!ready || data.activeWorkspaceId !== workspaceId)
    return <div className="app-loading">Opening your workspace…</div>
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
  const route = useNavigate()
  const router = useRouter()
  const location = useLocation()
  const params = useParams({ strict: false })
  const segment = location.pathname.split("/")[2] ?? "overview"
  const view = (segment[0]!.toUpperCase() + segment.slice(1)) as View
  const projectId = params.projectId ?? ""
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1000)
  const [navOpen, setNavOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const navigate = (next: View) => {
    void route({ href: workspaceUrl(workspace.id, next.toLowerCase()) })
    setNavOpen(false)
  }
  const selectProject = (id: string) => {
    void route({ href: workspaceUrl(workspace.id, `projects/${id}`) })
    setNavOpen(false)
  }
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event
          .composedPath()
          .some(
            (element) =>
              element instanceof HTMLElement &&
              (element.isContentEditable ||
                ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)),
          )
      )
        return
      if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "c")
        void route({ href: workspaceUrl(workspace.id, "issues/new") })
    }
    window.addEventListener("keydown", shortcut)
    return () => window.removeEventListener("keydown", shortcut)
  }, [workspace.id, route])
  return (
    <div className="app-viewport">
      <div className={`app-shell ${chatOpen ? "with-chat" : ""} ${navOpen ? "nav-open" : ""}`}>
        <Sidebar
          workspace={workspace}
          workspaces={workspaces}
          view={view}
          projectId={projectId}
          onNavigate={navigate}
          onProject={selectProject}
          onCreate={() => {
            void route({ href: workspaceUrl(workspace.id, "issues/new") })
            setNavOpen(false)
          }}
          onReset={() => setResetOpen(true)}
          onWorkspace={(id) => void route({ href: workspaceUrl(id, "overview") })}
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
          <main className="main-content" data-scroll-restoration-id="workspace-content">
            <Outlet />
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
              <span>Connected to your workspace</span>
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
            <Astro
              workspace={workspace}
              visitorId={visitorId}
              onOpen={(issue) =>
                void route({ href: workspaceUrl(workspace.id, `issues/${issue.id}`) })
              }
              navigation={{
                current: () => router.state.location.href,
                go: async (url) => {
                  await router.navigate({ href: url })
                },
              }}
            />
          </div>
          <div className="astro-footer">
            <SparkleIcon size={12} />
            Powered by{" "}
            <a href="https://astralbeam.ai" target="_blank" rel="noreferrer">
              AstralBeam
            </a>
          </div>
        </aside>
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
              <Button
                type="button"
                onClick={() => {
                  demoStore.reset()
                  void route({ href: workspaceUrl(demoWorkspaces[0].id, "overview") })
                }}
              >
                Reset everything
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
