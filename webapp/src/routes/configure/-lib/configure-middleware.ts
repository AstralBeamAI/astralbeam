import { createMiddleware } from "@tanstack/react-start"

export const configureMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { requireConfigureRequest } = await import("./configure-request.server")
    const { getConfigureSession } = await import("./configure-access.server")
    const { setResponseStatus } = await import("@tanstack/react-start/server")
    const { runDatabaseEffect } = await import("@/db")
    const { withDogfoodProvisioningLock } = await import("@/db/dogfood.server")
    const { Effect, Predicate } = await import("effect")
    requireConfigureRequest()
    const configureSession = getConfigureSession()
    const unauthorized = new Error(
      "Configuration requires an operator session and dogfood ownership",
    )
    return runDatabaseEffect(withDogfoodProvisioningLock(Effect.gen(function* () {
      if (!(yield* configureSession)) {
        return yield* Effect.fail(unauthorized)
      }
      return yield* Effect.tryPromise({ try: () => next(), catch: (error) => error })
    }))).catch((error: unknown) => {
      if (error === unauthorized) setResponseStatus(403)
      else if (Predicate.isTagged(error, "OwnerOnboardingError")) {
        setResponseStatus(409)
        throw new Error("Configuration is busy. Try again shortly.")
      }
      throw error
    })
  },
)
