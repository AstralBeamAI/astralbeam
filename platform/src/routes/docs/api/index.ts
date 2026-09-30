import { createFileRoute } from "@tanstack/react-router"

import {
  APP_LOGO_DARK_SVG_URL,
  APP_LOGO_LIGHT_SVG_URL,
  APP_NAME,
  APP_WORDMARK_DARK_SVG_URL,
  APP_WORDMARK_LIGHT_SVG_URL,
} from "@/lib/constants"

export const Route = createFileRoute("/docs/api/")({
  server: {
    handlers: {
      GET: async () => {
        const { apiDocsHtml } = await import("../-lib/scalar.server")
        // A static copy of the React `DocsNavbar`, since Scalar renders outside the app's React tree.
        const html = apiDocsHtml().replace(
          "<body>",
          `<body><header class="docs-header api-docs-header">
              <a class="docs-logo" href="/docs" aria-label="${APP_NAME} home">
                <span class="docs-marks">
                  <img class="docs-mark docs-light" src="${APP_LOGO_LIGHT_SVG_URL}" alt="">
                  <img class="docs-mark docs-dark" src="${APP_LOGO_DARK_SVG_URL}" alt="">
                </span>
                <span class="docs-wordmarks">
                  <img class="docs-wordmark docs-light" src="${APP_WORDMARK_LIGHT_SVG_URL}" alt="">
                  <img class="docs-wordmark docs-dark" src="${APP_WORDMARK_DARK_SVG_URL}" alt="">
                </span>
              </a>
              <nav aria-label="Main">
                <button type="button" class="docs-theme-toggle" data-docs-theme-toggle aria-label="Toggle theme" title="Toggle theme">
                  <svg class="docs-dark" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z"/></svg>
                  <svg class="docs-light" width="16" height="16" fill="currentColor" viewBox="0 0 256 256" aria-hidden="true"><path d="M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.7-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,62.06,79.1a87.09,87.09,0,0,1,31.4-26.29A104.12,104.12,0,0,0,192,152a103.38,103.38,0,0,0,23.19-2.64A87.09,87.09,0,0,1,188.9,190.34Z"/></svg>
                </button>
                <a class="docs-nav-link" href="/">Home</a>
                <a class="docs-nav-link" href="/auth/sign-in">Sign In</a>
                <a class="docs-nav-link docs-nav-primary" href="/auth/sign-up">Sign Up</a>
              </nav>
            </header>`,
        )
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })
      },
    },
  },
})
