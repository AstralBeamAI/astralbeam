import { Effect } from "effect"

import { getAppRuntime } from "@/lib/runtime/runtime.server"
import { Config, notConfiguredResponse } from "./config.server.ts"

/** A Promise bridge for the REST routes. Effect code reads `Config.setupState` instead. */
export function setupGateResponse(): Promise<Response | null> {
  return getAppRuntime().runPromise(
    Effect.flatMap(Config, (config) => config.setupState).pipe(
      Effect.map((state) => (state.setupComplete ? null : notConfiguredResponse())),
    ),
  )
}
