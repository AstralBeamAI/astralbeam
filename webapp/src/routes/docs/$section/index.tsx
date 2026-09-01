import { createFileRoute, notFound, redirect } from "@tanstack/react-router"
import { findDocsSection } from "../-lib/content"

// A bare section URL lands on its first page, so /docs/sdk stays a stable shareable link.
export const Route = createFileRoute("/docs/$section/")({
  beforeLoad: ({ params }) => {
    const section = findDocsSection(params.section)
    if (!section) throw notFound()
    throw redirect({
      to: "/docs/$section/$page",
      params: { section: section.slug, page: section.pages[0]!.slug },
      replace: true,
    })
  },
})
