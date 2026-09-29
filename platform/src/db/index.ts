import "@tanstack/react-start/server-only"

import type { Effect } from "effect"

import { type AppServices, getAppRuntime } from "@/lib/runtime/runtime.server"

export * from "./database.server.ts"

/** Legacy bridge to the app runtime. New boundaries use `@/lib/runtime/server-fn.server`. */
export function runDatabaseEffect<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  options?: Effect.RunOptions,
): Promise<A> {
  return getAppRuntime().runPromise(effect, options)
}
