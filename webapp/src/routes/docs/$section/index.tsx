import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { findDocsSection, publishedDocsPages } from "../-lib/content"

// A bare section URL lands on its first page, so /docs/sdk stays a stable shareable link.
export const Route = createFileRoute("/docs/$section/")({
  beforeLoad: ({ params }) => {
    const section = findDocsSection(params.section)
    if (!section) throw notFound()
    if (section.href) throw redirect({ href: section.href, reloadDocument: true })
    throw redirect({
      to: "/docs/$section/$page",
      params: { section: section.slug, page: publishedDocsPages(section)[0]!.slug },
      replace: true,
    })
  },
})
