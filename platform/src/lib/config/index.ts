import "@tanstack/react-start/server-only"

import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Config } from "./config.server.ts"
import type { ConfigKey, ConfigValues } from "./types.ts"

/** A Promise bridge for code outside Effect. Effect code yields the `Config` service instead. */
export function getGlobalConfig<Key extends ConfigKey>(key: Key): Promise<ConfigValues[Key]> {
  return runAppEffect(Effect.flatMap(Config, (config) => config.get(key)))
}
