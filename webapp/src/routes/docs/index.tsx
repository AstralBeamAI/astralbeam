import { createFileRoute, Link } from "@tanstack/react-router"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { APP_NAME } from "@/lib/constants"
import { DOCS_SECTIONS } from "./-lib/content"

export const Route = createFileRoute("/docs/")({
  head: () => ({ meta: [{ title: `Docs · ${APP_NAME}` }] }),
  component: DocsHomePage,
})

function DocsHomePage() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-heading text-3xl font-semibold tracking-tight">Documentation</h1>
      <p className="mt-2 text-muted-foreground">
        Guides for building on {APP_NAME}.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {DOCS_SECTIONS.map((section) => (
          <Link
            key={section.slug}
            to="/docs/$section/$page"
            params={{ section: section.slug, page: section.pages[0]!.slug }}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="h-full transition-colors hover:bg-muted/50">
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
