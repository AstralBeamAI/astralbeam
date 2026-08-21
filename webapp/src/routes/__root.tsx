import { TanStackDevtools } from "@tanstack/react-devtools"
import type { QueryClient } from "@tanstack/react-query"
import { createRootRouteWithContext, HeadContent, Scripts } from "@tanstack/react-router"
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools"

import appCss from "@/styles.css?url"
import { Providers } from "@/components/providers"

// Route-managed head styles apply before first paint and keep theme selection app-owned. https://tanstack.com/router/latest/docs/guide/document-head-management
const devtoolsConfig = { position: "bottom-right" } as const
const devtoolsPlugins = [
  {
    name: "Tanstack Router",
    render: <TanStackRouterDevtoolsPanel />,
  },
]

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "AstralBeam",
      },
    ],
    links: [
      {
        rel: "icon",
        type: "image/png",
        href: "/astralbeam-logo-light.png",
        sizes: "270x270",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/astralbeam-logo-light.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/astralbeam-logo-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "license",
        href: "/LICENSE-AGPL",
      },
    ],
  }),
  notFoundComponent: () => (
    <main className="container mx-auto p-4 pt-16">
      <h1>404</h1>
      <p>The requested page could not be found.</p>
    </main>
  ),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Providers>{children}</Providers>
        <TanStackDevtools config={devtoolsConfig} plugins={devtoolsPlugins} />
        <Scripts />
      </body>
    </html>
  )
}
