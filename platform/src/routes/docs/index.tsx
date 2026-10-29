import { createFileRoute } from "@tanstack/react-router"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/constants"
import { DOCS_SECTIONS, publishedDocsPages } from "./-lib/content"

export const Route = createFileRoute("/docs/")({
  head: () => ({
    meta: [
      { title: `Docs · ${APP_NAME}` },
      {
        name: "description",
        content: `Build with ${APP_NAME}: embed an agent, connect tools, manage tenants, and deploy the platform.`,
      },
    ],
    links: [{ rel: "alternate", type: "text/markdown", href: "/docs.md" }],
  }),
  component: DocsHomePage,
})

function DocsHomePage() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 max-w-prose leading-7 text-muted-foreground">
        Embed an agent in your app, connect tools, or run AstralBeam on your own infrastructure.
      </p>
      <h2 className="mt-8 font-heading text-xl font-semibold">Choose a starting point</h2>
      <ul className="mt-4 list-disc space-y-2 ps-6 leading-7">
        <li>
          <a href="/docs/start/quickstart" className="text-primary underline underline-offset-4">
            Embed your first agent
          </a>
        </li>
        <li>
          <a
            href="/docs/start/todos-tutorial"
            className="text-primary underline underline-offset-4"
          >
            Build tools and widgets with the Todos tutorial
          </a>
        </li>
        <li>
          <a href="/docs/api" className="text-primary underline underline-offset-4">
            Manage customers and users through the API
          </a>
        </li>
        <li>
          <a href="/docs/self-hosting/deploy" className="text-primary underline underline-offset-4">
            Deploy on your own infrastructure
          </a>
        </li>
      </ul>
      <h2 className="mt-10 font-heading text-xl font-semibold">Browse by section</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {DOCS_SECTIONS.filter((section) => !section.draft).map((section) => (
          <a
            key={section.slug}
            href={section.href ?? `/docs/${section.slug}/${publishedDocsPages(section)[0]!.slug}`}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader className="gap-2">
                <CardTitle className="text-base">{section.title}</CardTitle>
                <CardDescription className="text-sm/6">{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
    </main>
  )
}
