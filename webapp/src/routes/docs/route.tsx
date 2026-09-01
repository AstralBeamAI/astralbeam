import { createFileRoute, Link, Outlet } from "@tanstack/react-router"
import { APP_LOGO_LIGHT_SVG_URL, APP_NAME } from "@/lib/constants"

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
})

// Public documentation chrome: a slim top bar over the section content. Docs are
// intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-14 items-center gap-3 px-4">
          <Link to="/" className="flex items-center gap-2 font-heading font-semibold">
            <img src={APP_LOGO_LIGHT_SVG_URL} alt="" className="size-6" />
            {APP_NAME}
          </Link>
          <span className="text-muted-foreground">/</span>
          <Link to="/docs" className="font-medium text-muted-foreground hover:text-foreground">
            Docs
          </Link>
        </div>
      </header>
      <Outlet />
    </div>
  )
}
