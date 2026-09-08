import { createFileRoute, Link, Outlet, useLocation } from "@tanstack/react-router"
import { APP_NAME, APP_WORDMARK_DARK_SVG_URL, APP_WORDMARK_LIGHT_SVG_URL } from "@/lib/constants"
import "./-lib/header.css"

export const Route = createFileRoute("/docs")({
  component: DocsLayout,
})

// Public documentation chrome: a slim top bar over the section content. Docs are
// intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  const isSdk = useLocation({ select: ({ pathname }) => pathname.startsWith("/docs/sdk") })
  return (
    <div className="min-h-svh bg-background text-foreground">
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
              <Link to="/docs" aria-current={isSdk ? undefined : "page"}>Docs</Link>
            </li>
            {isSdk && (
              <li>
                <Link to="/docs/$section" params={{ section: "sdk" }} aria-current="location">
                  SDK
                </Link>
              </li>
            )}
          </ol>
        </nav>
      </header>
      <Outlet />
    </div>
  )
}
