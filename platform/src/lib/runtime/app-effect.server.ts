import type { Effect } from "effect"

import type { AppServices } from "./runtime.server.ts"

// Loaded on first use, because the services the app runtime builds reach it through callbacks,
// and a static import would evaluate their layers before the modules they depend on.
function loadAppRuntime() {
  return import("./runtime.server.ts").then((runtime) => runtime.getAppRuntime())
}

/** Runs an Effect on the app runtime from a library callback, such as a Better Auth hook. */
export function runAppEffect<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
  return loadAppRuntime().then((runtime) => runtime.runPromise(effect))
}

/** Starts an Effect on the app runtime without waiting for it, for work past the response. */
export function forkAppEffect(effect: Effect.Effect<void, never, AppServices>): void {
  void loadAppRuntime().then((runtime) => runtime.runFork(effect))
}
