import { createFileRoute, Link, notFound } from "@tanstack/react-router"
import { APP_NAME } from "@/lib/constants"
import { DocsMarkdown } from "../../-components/docs-markdown"
import { findDocsPage, findDocsSection } from "../../-lib/content"

export const Route = createFileRoute("/docs/$section/$page/")({
  loader: ({ params }) => {
    const section = findDocsSection(params.section)
    const page = section ? findDocsPage(section, params.page) : undefined
    if (!section || !page) throw notFound()
    return { pageTitle: page.title }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.pageTitle} · Docs · ${APP_NAME}` }],
  }),
  component: DocsArticlePage,
})

function DocsArticlePage() {
  const { section: sectionSlug, page: pageSlug } = Route.useParams()
  // The loader already 404s unknown params, so both lookups are non-null here.
  const section = findDocsSection(sectionSlug)!
  const page = findDocsPage(section, pageSlug)!
  return (
    <div className="container mx-auto flex max-w-6xl gap-10 px-4 py-10">
      <nav aria-label={`${section.title} pages`} className="hidden w-52 shrink-0 md:block">
        <p className="mb-3 text-sm font-semibold">{section.title}</p>
        <ul className="space-y-1 border-s">
          {section.pages.map((entry) => (
            <li key={entry.slug}>
              <Link
                to="/docs/$section/$page"
                params={{ section: section.slug, page: entry.slug }}
                className="-ms-px block border-s border-transparent py-1 ps-3 text-sm text-muted-foreground hover:text-foreground"
                activeProps={{
                  className: "border-primary font-medium text-foreground",
                }}
              >
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="min-w-0 max-w-3xl flex-1 pb-16">
        <DocsMarkdown markdown={page.markdown} sectionSlug={section.slug} />
      </main>
    </div>
  )
}
