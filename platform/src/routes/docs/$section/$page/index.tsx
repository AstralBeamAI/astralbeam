import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import { APP_NAME } from "@/lib/constants"
import { DocsMarkdown } from "../../-components/docs-markdown"
import {
  DOCS_SECTIONS,
  findDocsArticleNeighbors,
  findDocsPage,
  findDocsSection,
  loadDocsMarkdown,
  publishedDocsPages,
} from "../../-lib/content"

export const Route = createFileRoute("/docs/$section/$page/")({
  loader: async ({ params }) => {
    const section = findDocsSection(params.section)
    if (section?.href) {
      const anchor = section.anchors?.[params.page]
      if (!anchor) throw notFound()
      throw redirect({ href: `${section.href}#${anchor}`, reloadDocument: true })
    }
    const page = section ? findDocsPage(section, params.page) : undefined
    if (!section || !page) throw notFound()
    return { pageTitle: page.title, markdown: await loadDocsMarkdown(section.slug, page.slug) }
  },
  head: ({ loaderData, params }) => ({
    meta: [{ title: `${loaderData?.pageTitle} · Docs · ${APP_NAME}` }],
    links: [
      {
        rel: "alternate",
        type: "text/markdown",
        href: `/docs/${params.section}/${params.page}.md`,
      },
    ],
  }),
  component: DocsArticlePage,
})

function DocsArticlePage() {
  const { markdown } = Route.useLoaderData()
  const params = Route.useParams()
  // The loader already 404s an unknown section, so this lookup is non-null here.
  const section = findDocsSection(params.section)!
  const { previous, next } = findDocsArticleNeighbors({
    sections: DOCS_SECTIONS,
    sectionSlug: section.slug,
    pageSlug: params.page,
  })
  return (
    <div className="container mx-auto flex max-w-6xl gap-10 px-4 py-10">
      <nav aria-label={`${section.title} pages`} className="hidden w-52 shrink-0 md:block">
        <p className="mb-3 text-sm font-semibold">{section.title}</p>
        <ul className="space-y-1 border-s">
          {publishedDocsPages(section).map((entry) => (
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
        <DocsMarkdown markdown={markdown} sectionSlug={section.slug} />
        <nav
          aria-label="Article navigation"
          className="mt-10 grid gap-4 border-t pt-6 sm:grid-cols-2"
        >
          {previous && (
            <Link
              to="/docs/$section/$page"
              params={{ section: previous.section.slug, page: previous.page.slug }}
              rel="prev"
              className="min-w-0 rounded-lg border p-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span className="block text-sm text-muted-foreground">Previous</span>
              <span className="mt-1 block font-medium wrap-break-word">
                {previous.section.title}: {previous.page.title}
              </span>
            </Link>
          )}
          {next && (
            <Link
              to="/docs/$section/$page"
              params={{ section: next.section.slug, page: next.page.slug }}
              rel="next"
              className="min-w-0 rounded-lg border p-4 text-end hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:col-start-2"
            >
              <span className="block text-sm text-muted-foreground">Next</span>
              <span className="mt-1 block font-medium wrap-break-word">
                {next.section.title}: {next.page.title}
              </span>
            </Link>
          )}
        </nav>
      </main>
    </div>
  )
}
