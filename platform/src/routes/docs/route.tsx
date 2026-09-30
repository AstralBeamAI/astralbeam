import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { DocsNavbar, UnderNavbar } from "@/components/navbar"
import { findDocsSection } from "./-lib/content"
import { docsHighlightCss } from "./-lib/highlight"

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
})

// Docs are intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  const section = useLocation({
    select: ({ pathname }) => findDocsSection(pathname.split("/")[2] ?? ""),
  })
  return (
    <div className="min-h-svh bg-background text-foreground">
      <style>{docsHighlightCss}</style>
      <DocsNavbar section={section} />
      <UnderNavbar>
        <Outlet />
      </UnderNavbar>
    </div>
  )
}
