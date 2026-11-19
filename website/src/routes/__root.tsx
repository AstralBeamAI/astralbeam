import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router"
import type { ReactNode } from "react"

import astralbeamDarkLogoUrl from "@/assets/astralbeam-logo-dark.svg?url&no-inline"
import astralbeamLightLogoUrl from "@/assets/astralbeam-logo-light.svg?url&no-inline"
import { palette } from "@/brand/palette"
import { SignalLost } from "@/components/signal-lost"
import { SessionIndicator } from "@/components/session-indicator"
import { siteMetadata, siteUrl } from "@/lib/site"
import appCss from "@/styles/index.css?url"

const homeUrl = siteUrl("/")
const structuredData = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${homeUrl}#organization`,
  name: siteMetadata.name,
  url: homeUrl,
  logo: siteUrl(astralbeamLightLogoUrl),
  description: siteMetadata.description,
  email: siteMetadata.email,
  sameAs: [siteMetadata.links.github, siteMetadata.links.discord],
}

export const Route = createRootRoute({
  headers: () => ({ "Cache-Control": "public, no-cache" }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "application-name", content: siteMetadata.name },
      { name: "theme-color", content: palette.dark.background.srgbHex },
      { name: "color-scheme", content: "dark" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", sizes: "16x16 32x32 48x48" },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: astralbeamLightLogoUrl,
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: astralbeamDarkLogoUrl,
        media: "(prefers-color-scheme: dark)",
      },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "license", href: "/licenses.txt" },
      { rel: "sitemap", href: "/sitemap.xml" },
      {
        rel: "alternate",
        type: "application/rss+xml",
        title: "AstralBeam Blog",
        href: "/blog/feed.xml",
      },
      { rel: "stylesheet", href: appCss },
    ],
    scripts: [{ type: "application/ld+json", children: JSON.stringify(structuredData) }],
  }),
  notFoundComponent: SignalLost,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html className="dark" lang="en">
      <head>
        <SessionIndicator />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
