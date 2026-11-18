import { spawn } from "node:child_process"

import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { installPlatformRelease } from "@/lib/runtime/platform-release.server"
import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"
import { PlatformUpdateMigrationFailed } from "../-lib/errors"

const InstallUpdateInput = Schema.Struct({
  version: Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/)),
  serviceName: Schema.String.check(
    Schema.isPattern(/^[\w@][\w@.:-]*$/, { message: "Must be a systemd service name" }),
  ),
})

function runCommand(
  command: string,
  args: string[],
  stdout: "inherit" | "pipe" = "inherit",
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", stdout, "inherit"] })
    let output = ""
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.once("error", reject)
    child.once("close", (code) => resolve({ code, output }))
  })
}

async function restartSystemdService(name: string): Promise<"restarted" | "missing" | "failed"> {
  // Hosts without systemd fail to spawn `systemctl`, and unknown units report `not-found`.
  const unit = await runCommand(
    "systemctl",
    ["show", "--property=LoadState", "--value", "--", name],
    "pipe",
  ).catch(() => undefined)
  if (unit?.output.trim() !== "loaded") return "missing"
  // Queue the restart without waiting, so this response finishes before systemd stops the server.
  const { code } = await runCommand("systemctl", ["restart", "--no-block", "--", name])
  return code === 0 ? "restarted" : "failed"
}

/** Applies the candidate release's migrations before replacing the binary and restarting. */
export const installUpdate = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(InstallUpdateInput))
  .handler(
    effectHandler(({ data }) =>
      Effect.gen(function* () {
        const installed = yield* Effect.promise(() =>
          installPlatformRelease(data.version, async (candidate) => {
            const { code } = await runCommand(candidate, ["migrate"])
            return code === 0
          }),
        )
        if (!installed) return yield* new PlatformUpdateMigrationFailed()
        return yield* Effect.promise(() => restartSystemdService(data.serviceName))
      }).pipe(Effect.catchTag("PlatformUpdateMigrationFailed", exposeError)),
    ),
  )
