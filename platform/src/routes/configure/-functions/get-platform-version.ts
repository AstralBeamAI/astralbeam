import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { version } from "@/../package.json" with { type: "json" }
import {
  RELEASE_TARGET,
  comparePlatformVersions,
  fetchLatestPlatformVersion,
} from "@/lib/runtime/platform-release.server"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { configureMiddleware } from "../-lib/configure-middleware"

/** Returns the running and latest release versions when a release binary can upgrade itself. */
export const getPlatformVersion = createServerFn({ method: "GET" })
  .middleware([configureMiddleware])
  .handler(
    effectHandler(() =>
      Effect.gen(function* () {
        if (!Bun.isStandaloneExecutable || !RELEASE_TARGET) return null
        const latestVersion = yield* Effect.promise(fetchLatestPlatformVersion)
        return {
          currentVersion: version,
          latestVersion,
          updateAvailable: comparePlatformVersions(latestVersion, version) > 0,
        }
      }),
    ),
  )
