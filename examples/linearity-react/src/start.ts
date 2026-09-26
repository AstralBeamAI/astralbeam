import process from "node:process"
import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start"
import { basicAuth } from "./lib/auth.server.ts"

const playgroundAuth = createMiddleware().server(async ({ request, next }) => {
  const denied = basicAuth(
    request,
    process.env.BASIC_AUTH_USERNAME,
    process.env.BASIC_AUTH_PASSWORD,
  )
  if (denied) return denied
  const result = await next()
  result.response.headers.set("Cache-Control", "private, no-store")
  result.response.headers.set("X-Robots-Tag", "noindex, nofollow")
  return result
})
export const startInstance = createStart(() => ({
  requestMiddleware: [
    playgroundAuth,
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
  ],
}))
