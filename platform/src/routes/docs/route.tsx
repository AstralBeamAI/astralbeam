import { createFileRoute, Outlet, useLocation } from "@tanstack/react-router"
import { useEffect } from "react"
import { DocsNavbar, UnderNavbar } from "@/components/navbar"
import { findDocsSection } from "./-lib/content"
import { docsHighlightCss } from "./-lib/highlight"

export const Route = createFileRoute("/docs")({
  head: () => ({
    styles: [{ children: ".docs-fonts-loading .docs-fonts { visibility: hidden }" }],
    scripts: [
      {
        // Wait for font layout before painting docs, with a fallback for stalled requests.
        // https://developer.mozilla.org/en-US/docs/Web/API/FontFaceSet/ready
        children: `{
  document.documentElement.classList.add("docs-fonts-loading");
  const show = () => document.documentElement.classList.remove("docs-fonts-loading");
  setTimeout(show, 3000);
  ${import.meta.env.DEV ? "" : `Promise.all(["Inter Variable", "Manrope Variable"].map(font => document.fonts.load('16px "' + font + '"'))).then(() => document.fonts.ready).then(show, show);`}
}`,
      },
    ],
  }),
  component: DocsLayout,
})

// Docs are intentionally unauthenticated, like a package's hosted documentation site.
function DocsLayout() {
  // Vite registers development font faces when the client CSS module executes.
  useEffect(() => {
    if (import.meta.env.DEV) {
      const show = () => document.documentElement.classList.remove("docs-fonts-loading")
      void Promise.all(
        ["Inter Variable", "Manrope Variable"].map((font) =>
          document.fonts.load('16px "' + font + '"'),
        ),
      )
        .then(() => document.fonts.ready)
        .then(show, show)
    }
  }, [])
  const section = useLocation({
    select: ({ pathname }) => findDocsSection(pathname.split("/")[2] ?? ""),
  })
  return (
    <div className="docs-fonts min-h-svh bg-background text-foreground">
      <style>{docsHighlightCss}</style>
      <DocsNavbar section={section} />
      <UnderNavbar>
        <Outlet />
      </UnderNavbar>
    </div>
  )
}
