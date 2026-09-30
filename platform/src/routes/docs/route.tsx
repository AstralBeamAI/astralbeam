import { createFileRoute, Outlet } from "@tanstack/react-router"
import { DocsNavbar, UnderNavbar } from "@/components/navbar"
import { docsHighlightCss } from "./-lib/highlight"

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
})

// Docs are intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <style>{docsHighlightCss}</style>
      <DocsNavbar />
      <UnderNavbar>
        <Outlet />
      </UnderNavbar>
    </div>
  )
}
