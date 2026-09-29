import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Config, type ConfigSnapshot } from "./config.server.ts"

/** A Promise bridge for the email seam. Effect code reads `Config.snapshot` instead. */
export function getGlobalConfigState(): Promise<ConfigSnapshot> {
  return runAppEffect(Effect.flatMap(Config, (config) => config.snapshot))
}
