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
              <button type="button" class="docs-theme-toggle" data-docs-theme-toggle aria-label="Theme" title="Theme">
                <svg data-theme-icon="system" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24h72v16H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16H136V200h72a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40ZM48,56H208a8,8,0,0,1,8,8v80H40V64A8,8,0,0,1,48,56ZM208,184H48a8,8,0,0,1-8-8V160H216v16A8,8,0,0,1,208,184Z"/></svg>
                <svg data-theme-icon="light" hidden width="16" height="16" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>
                <svg data-theme-icon="dark" hidden width="16" height="16" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.7-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,62.06,79.1a87.09,87.09,0,0,1,31.4-26.29A104.12,104.12,0,0,0,192,152a103.38,103.38,0,0,0,23.19-2.64A87.09,87.09,0,0,1,188.9,190.34Z"/></svg>
              </button>
            </header>`,
        )
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      },
    },
  },
})
