import { createFileRoute } from "@tanstack/react-router"
import { APP_NAME, APP_WORDMARK_DARK_SVG_URL, APP_WORDMARK_LIGHT_SVG_URL } from "@/lib/constants"
import { findDocsSection } from "../-lib/content"

export const Route = createFileRoute("/docs/api/")({
  server: {
    handlers: {
      GET: async () => {
        const { apiDocsHtml } = await import("../-lib/scalar.server")
        const { title } = findDocsSection("api")!
        const html = apiDocsHtml().replace(
          "<body>",
          `<body><header class="docs-header api-docs-header">
              <nav aria-label="Breadcrumb"><ol>
                <li><a href="/" aria-label="${APP_NAME} home">
                  <img class="docs-wordmark-light" src="${APP_WORDMARK_LIGHT_SVG_URL}" alt="${APP_NAME}">
                  <img class="docs-wordmark-dark" src="${APP_WORDMARK_DARK_SVG_URL}" alt="${APP_NAME}">
                </a></li>
                <li><a href="/docs">Docs</a></li>
                <li><a href="/docs/api" aria-current="page">${title}</a></li>
              </ol></nav>
            </header>`,
        )
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      },
    },
  },
})
