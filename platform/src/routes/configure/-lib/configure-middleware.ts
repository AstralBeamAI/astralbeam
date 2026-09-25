import { createMiddleware } from "@tanstack/react-start"
import { setResponseStatus } from "@tanstack/react-start/server"
import { Effect, Predicate } from "effect"

import { runDatabaseEffect } from "@/db"
import { withDogfoodProvisioningLock } from "@/db/dogfood.server"
import { requireConfigureRequest } from "./configure-request.server"
import { getOperatorSession } from "./operator-session.server"

export const configureMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    requireConfigureRequest()
    if (!(await getOperatorSession())) {
      setResponseStatus(403)
      throw new Error("Operator authentication required")
    }
    return runDatabaseEffect(
      withDogfoodProvisioningLock(
        Effect.tryPromise({ try: () => next(), catch: (error) => error }),
      ),
    ).catch((error: unknown) => {
      if (Predicate.isTagged(error, "OwnerOnboardingError")) {
        setResponseStatus(409)
        throw new Error("Configuration is busy. Try again shortly.")
      }
      throw error
    })
  },
)
