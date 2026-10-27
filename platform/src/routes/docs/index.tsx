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
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 text-muted-foreground">Build an assistant into your application.</p>
      <ul className="mt-6 list-disc space-y-2 ps-6">
        <li>
          <a href="/docs/start/quickstart" className="text-primary underline underline-offset-4">
            Embed your first assistant
          </a>
        </li>
        <li>
          <a
            href="/docs/start/todos-tutorial"
            className="text-primary underline underline-offset-4"
          >
            Connect application tools and live UI
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
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {DOCS_SECTIONS.filter((section) => !section.draft).map((section) => (
          <a
            key={section.slug}
            href={section.href ?? `/docs/${section.slug}/${publishedDocsPages(section)[0]!.slug}`}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </a>
        ))}
      </div>
    </main>
  )
}
