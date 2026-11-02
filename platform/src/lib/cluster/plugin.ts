import process from "node:process"

import { Effect } from "effect"
import type { NitroAppPlugin } from "nitro/types"
import type { ViteHotContext } from "vite/types/hot.d.ts"

import { stopEmbeddedPostgres } from "@/db/embedded-postgres.ts"
import { closeClusterProcess, startClusterRunner, stopClusterRunner } from "./runtime.ts"
import { serverLoggerLayer } from "../runtime/logging.server.ts"

const clusterPlugin: NitroAppPlugin = (nitro) => {
  if (import.meta.prerender || process.env.NODE_ENV === "test") return
  // These lifecycle roots run outside the app runtime and need its logger explicitly.
  Effect.runFork(startClusterRunner.pipe(Effect.provide(serverLoggerLayer)))

  // Vite provides this context, while Bun declares its own incompatible hot-reload interface.
  const hot = import.meta.hot as unknown as ViteHotContext | undefined
  hot?.dispose(() => {
    Effect.runFork(stopClusterRunner.pipe(Effect.provide(serverLoggerLayer)))
  })

  // Nitro calls close hooks after its HTTP server drains. https://nitro.build/docs/plugins
  nitro.hooks.hook("close", () =>
    Effect.runPromise(
      closeClusterProcess.pipe(
        Effect.timeout("5 seconds"),
        Effect.andThen(Effect.promise(stopEmbeddedPostgres)),
        Effect.matchCauseEffect({
          onSuccess: () => (hot ? Effect.void : Effect.sync(() => process.exit(0))),
          onFailure: (cause) =>
            Effect.logError("Server shutdown cleanup failed or timed out", cause).pipe(
              Effect.andThen(hot ? Effect.void : Effect.sync(() => process.exit(1))),
            ),
        }),
        Effect.provide(serverLoggerLayer),
      ),
    ),
  )
}

/** @knipignore Nitro loads this runtime plugin from vite.config.ts. */
export default clusterPlugin
