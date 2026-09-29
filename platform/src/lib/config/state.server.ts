import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Config } from "./config.server.ts"

/** A Promise bridge for the REST transport's setup gate. Effect code reads `Config.setupState`. */
export function isSetupComplete(): Promise<boolean> {
  return runAppEffect(
    Effect.map(
      Effect.flatMap(Config, (config) => config.setupState),
      (state) => state.setupComplete,
    ),
  )
}
