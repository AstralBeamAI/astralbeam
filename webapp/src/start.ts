import { createCsrfMiddleware, createStart } from "@tanstack/react-start"

// Declaring request middleware replaces the CSRF middleware the framework installs on its own.
// https://github.com/TanStack/router/blob/main/packages/start-server-core/src/createStartHandler.ts
const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" })

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}))
