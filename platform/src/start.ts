import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"

import { rewriteToWebsite } from "./routes/-lib/website-rewrite.server"

// Declaring request middleware replaces the CSRF middleware the framework installs on its own.
// https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts
const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })

const websiteRewriteMiddleware = createMiddleware().server(
  async ({ request, pathname, next }) => (await rewriteToWebsite(request, pathname)) ?? next(),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [websiteRewriteMiddleware, csrfMiddleware],
}))
