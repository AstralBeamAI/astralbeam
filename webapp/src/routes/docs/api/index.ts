import { createFileRoute } from "@tanstack/react-router"
import { APP_NAME, APP_WORDMARK_DARK_SVG_URL, APP_WORDMARK_LIGHT_SVG_URL } from "@/lib/constants"

export const Route = createFileRoute("/docs/api/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { apiDocsHandler, apiDocsStyles } = await import("../-lib/scalar.server")
        const response = await apiDocsHandler.handler(request)
        const html = (await response.text()).replace(
          "</head>",
          `<style>${apiDocsStyles}</style></head>`,
        ).replace(
          "<body>",
          `<body><header class="docs-header api-docs-header">
              <nav aria-label="Breadcrumb"><ol>
                <li><a href="/" aria-label="${APP_NAME} home">
                  <img class="docs-wordmark-light" src="${APP_WORDMARK_LIGHT_SVG_URL}" alt="${APP_NAME}">
                  <img class="docs-wordmark-dark" src="${APP_WORDMARK_DARK_SVG_URL}" alt="${APP_NAME}">
                </a></li>
                <li><a href="/docs">Docs</a></li>
                <li><a href="/docs/api" aria-current="page">API</a></li>
              </ol></nav>
            </header>`,
        )
        return new Response(html, response)
      },
    },
  },
})
