import { createFileRoute, Link, notFound, redirect } from "@tanstack/react-router"
import { parseMarkdown } from "@tanstack/markdown"
import { docsMarkdownExtensions } from "@tanstack/markdown/extensions/docs"
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
    return {
      pageTitle: `${page.title} · ${section.title}`,
      description: page.description,
      markdown: parseMarkdown(await loadDocsMarkdown(section.slug, page.slug), {
        extensions: docsMarkdownExtensions(),
      }),
    }
  },
  head: ({ loaderData, params }) => ({
    meta: [
      { title: `${loaderData?.pageTitle} · Docs · ${APP_NAME}` },
      { name: "description", content: loaderData?.description },
    ],
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
  const pageLinks = (
    <>
      <Link
        to="/docs"
        className="mb-5 block py-1.5 text-sm text-muted-foreground hover:text-foreground any-pointer-coarse:min-h-11 any-pointer-coarse:py-3"
      >
        All documentation
      </Link>
      <p className="mb-3 text-sm font-semibold">{section.title}</p>
      <ul className="space-y-1 border-s">
        {publishedDocsPages(section).map((entry) => (
          <li key={entry.slug}>
            <Link
              to="/docs/$section/$page"
              params={{ section: section.slug, page: entry.slug }}
              className="-ms-px block border-s border-transparent py-1.5 ps-3 text-sm text-muted-foreground hover:text-foreground any-pointer-coarse:min-h-11 any-pointer-coarse:py-3"
              activeProps={{ className: "border-primary font-medium text-foreground" }}
            >
              {entry.title}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-6 mb-2 text-sm font-semibold">Other sections</p>
      <ul>
        {DOCS_SECTIONS.filter((entry) => !entry.draft && entry.slug !== section.slug).map(
          (entry) => (
            <li key={entry.slug}>
              <Link
                to="/docs/$section"
                params={{ section: entry.slug }}
                className="block py-1.5 text-sm text-muted-foreground hover:text-foreground any-pointer-coarse:min-h-11 any-pointer-coarse:py-3"
              >
                {entry.title}
              </Link>
            </li>
          ),
        )}
      </ul>
    </>
  )
  const headings = markdown.headings?.filter((heading) => heading.level === 2) ?? []
  const outlineLinks = headings.map((heading) => (
    <li key={heading.id}>
      <a
        href={`#${heading.id}`}
        className="block py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring any-pointer-coarse:min-h-11 any-pointer-coarse:py-3"
      >
        {heading.text}
      </a>
    </li>
  ))
  return (
    <div className="container mx-auto grid max-w-7xl gap-8 px-4 py-8 md:grid-cols-[11rem_minmax(0,1fr)] lg:grid-cols-[11rem_minmax(0,1fr)_11rem]">
      <nav
        aria-label={`${section.title} pages`}
        className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start overflow-y-auto md:block"
      >
        {pageLinks}
      </nav>
      <main className="min-w-0 max-w-3xl pb-16">
        <div className="mb-6 space-y-2 lg:hidden">
          <details
            key={`browse:${section.slug}/${params.page}`}
            className="rounded-lg border px-4 md:hidden"
          >
            <summary className="cursor-pointer py-3 text-sm font-medium">Browse docs</summary>
            <nav aria-label="Browse documentation" className="pb-4">
              {pageLinks}
            </nav>
          </details>
          {headings.length > 0 && (
            <details
              key={`outline:${section.slug}/${params.page}`}
              className="rounded-lg border px-4"
            >
              <summary className="cursor-pointer py-3 text-sm font-medium">On this page</summary>
              <nav aria-label="On this page" className="pb-3">
                <ul>{outlineLinks}</ul>
              </nav>
            </details>
          )}
        </div>
        <DocsMarkdown
          key={`${section.slug}/${params.page}`}
          markdown={markdown}
          sectionSlug={section.slug}
        />
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
      {headings.length > 0 && (
        <nav
          aria-label="On this page"
          className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] self-start overflow-y-auto lg:block"
        >
          <p className="mb-3 text-sm font-semibold">On this page</p>
          <ul className="border-s ps-4">{outlineLinks}</ul>
        </nav>
      )}
    </div>
  )
}
