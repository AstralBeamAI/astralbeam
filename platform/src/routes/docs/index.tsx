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
        Add an assistant to your app, connect it to your data, and let users take action in chat.
      </p>
      <section aria-labelledby="start-here" className="mt-8 border bg-card p-6">
        <h2 id="start-here" className="font-heading text-xl font-semibold">
          Embed your first agent
        </h2>
        <p className="mt-2 max-w-prose leading-7 text-muted-foreground">
          Use your existing login and a model-provider API key to add chat to a React app.
        </p>
        <a
          href="/docs/start/quickstart"
          className="mt-4 inline-flex min-h-11 items-center bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View Quickstart guide
        </a>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Have chat working?{" "}
          <a
            href="/docs/start/todos-tutorial"
            className="text-primary underline underline-offset-4"
          >
            Connect tools and live widgets in the Todos tutorial.
          </a>
        </p>
      </section>
      <h2 className="mt-8 font-heading text-xl font-semibold">Other ways to build</h2>
      <ul className="mt-4 list-disc space-y-2 ps-6 leading-7">
        <li>
          <a
            href="/docs/cli/coding-agents#integrate-your-app"
            className="text-primary underline underline-offset-4"
          >
            Integrate with your coding agent
          </a>
        </li>
        <li>
          <a href="/docs/sdk/getting-started" className="text-primary underline underline-offset-4">
            Embed chat with JavaScript
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
