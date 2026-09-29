import { createHash } from "node:crypto"
import process from "node:process"

import { Effect } from "effect"

import { APP_HANDLE } from "../constants.ts"

// The adapter cannot label containers yet, so a per-deployment marker rides in the keep-alive argv.
// https://github.com/TanStack/ai/blob/main/packages/ai-sandbox-docker/src/provider.ts
function dockerSandboxMarker(): string {
  const database = URL.parse(process.env.DATABASE_URL ?? "")
  const deployment = `${database?.host}${database?.pathname}:${process.env.PORT ?? ""}`
  return `${APP_HANDLE}-sandbox-${createHash("sha256").update(deployment).digest("hex").slice(0, 16)}`
}

/** Exits on SIGTERM, which `tail` as PID 1 ignores, so a stop skips the 5-second grace period. */
export function dockerKeepAliveCommand(): string[] {
  return ["sh", "-c", "trap 'exit 0' TERM; tail -f /dev/null & wait", dockerSandboxMarker()]
}

// Leases live only in memory, so a marked container created before this process is an orphan of
// a killed one. An unreachable Docker daemon skips this silently.
export const removeOrphanedDockerSandboxes = Effect.gen(function* () {
  const { default: Dockerode } = yield* Effect.tryPromise(() => import("dockerode"))
  const docker = new Dockerode()
  const marker = ` ${dockerSandboxMarker()}`
  const started = Math.floor(performance.timeOrigin / 1_000)
  const containers = yield* Effect.tryPromise(() => docker.listContainers({ all: true }))
  const orphans = containers.filter(
    (container) => container.Created < started && container.Command.endsWith(marker),
  )
  if (orphans.length === 0) return
  const [failed, removed] = yield* Effect.partition(
    orphans,
    (container) =>
      Effect.tryPromise(() => docker.getContainer(container.Id).remove({ force: true, v: true })),
    { concurrency: "unbounded" },
  )
  yield* Effect.logInfo("Removed orphaned Docker sandboxes").pipe(
    Effect.annotateLogs({ removed: removed.length, failed: failed.length }),
  )
}).pipe(Effect.ignore)
