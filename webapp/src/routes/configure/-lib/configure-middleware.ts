import { createMiddleware } from "@tanstack/react-start"

export const configureMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { requireConfigureRequest } = await import("./configure-request.server")
    const { getOperatorSession } = await import("./operator-session.server")
    const { setResponseStatus } = await import("@tanstack/react-start/server")
    const { runDatabaseEffect } = await import("@/db")
    const { withDogfoodProvisioningLock } = await import("@/db/dogfood.server")
    const { Effect, Predicate } = await import("effect")
    requireConfigureRequest()
    if (!await getOperatorSession()) {
      setResponseStatus(403)
      throw new Error("Operator authentication required")
    }
    return runDatabaseEffect(withDogfoodProvisioningLock(
      Effect.tryPromise({ try: () => next(), catch: (error) => error }),
    )).catch((error: unknown) => {
      if (Predicate.isTagged(error, "OwnerOnboardingError")) {
        setResponseStatus(409)
        throw new Error("Configuration is busy. Try again shortly.")
      }
      throw error
    })
  },
)
