import { createFileRoute } from "@tanstack/react-router"

const DEVELOPMENT_INDEX = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Development tools</title>
  <link rel="stylesheet" href="/src/styles.css">
</head>
<body class="min-h-svh bg-background text-foreground antialiased">
  <main class="mx-auto flex min-h-svh max-w-3xl items-center px-6 py-16">
    <section class="w-full space-y-8">
      <header class="space-y-2">
        <p class="text-sm font-medium text-primary">AstralBeam development</p>
        <h1 class="font-heading text-3xl font-semibold tracking-tight">Development tools</h1>
        <p class="text-muted-foreground">Local utilities available only while the development server is running.</p>
      </header>
      <a class="group flex items-center justify-between rounded-lg border bg-card p-5 shadow-sm transition-colors hover:bg-accent" href="/dev/emails">
        <span>
          <span class="block font-medium">Email previews</span>
          <span class="mt-1 block text-sm text-muted-foreground">Review application emails with synthetic data.</span>
        </span>
        <span class="text-xl text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
      </a>
    </section>
  </main>
</body>
</html>`

export const Route = createFileRoute("/dev/$")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!import.meta.env.DEV) return new Response("Not Found", { status: 404 })

        const path = params._splat?.replace(/\/+$/, "") ?? ""
        if (!path) {
          return new Response(DEVELOPMENT_INDEX, {
            headers: { "content-type": "text/html; charset=utf-8" },
          })
        }

        const emailPath = /^emails(?:\/([^/]+))?$/.exec(path)
        if (!emailPath) return new Response("Not Found", { status: 404 })

        const { handleEmailPreviewRequest } = await import("@/emails/preview.server.ts")
        return handleEmailPreviewRequest(request, emailPath[1])
      },
      ANY: () => {
        if (!import.meta.env.DEV) return new Response("Not Found", { status: 404 })
        return new Response("Method Not Allowed", { status: 405 })
      },
    },
  },
})
