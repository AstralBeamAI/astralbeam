import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router"
import { ThemeToggle } from "@/components/theme-toggle"
import { APP_NAME, APP_WORDMARK_DARK_SVG_URL, APP_WORDMARK_LIGHT_SVG_URL } from "@/lib/constants"
import { findDocsSection } from "./-lib/content"
import { docsHighlightCss } from "./-lib/highlight"
import "./-lib/header.css"

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
})

// Public documentation chrome: a slim top bar over the section content. Docs are
// intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  const section = useLocation({
    select: ({ pathname }) => findDocsSection(pathname.split("/")[2] ?? ""),
  })
  return (
    <div className="min-h-svh bg-background text-foreground">
      <style>{docsHighlightCss}</style>
      <header className="docs-header">
        <nav aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/" aria-label={`${APP_NAME} home`}>
                <img
                  className="docs-wordmark-light"
                  src={APP_WORDMARK_LIGHT_SVG_URL}
                  alt={APP_NAME}
                />
                <img
                  className="docs-wordmark-dark"
                  src={APP_WORDMARK_DARK_SVG_URL}
                  alt={APP_NAME}
                />
              </Link>
            </li>
            <li>
              <Link to="/docs" aria-current={section ? undefined : "page"}>Docs</Link>
            </li>
            {section && (
              <li>
                <Link
                  to="/docs/$section"
                  params={{ section: section.slug }}
                  aria-current="location"
                >
                  {section.title}
                </Link>
              </li>
            )}
          </ol>
        </nav>
        <ThemeToggle />
      </header>
      <Outlet />
    </div>
  )
}
