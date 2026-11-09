import { spawn } from "node:child_process"
import process from "node:process"

import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { installPlatformRelease } from "@/lib/runtime/platform-release.server"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

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

/** Replaces the release binary, applies its migrations, and restarts the named service. */
export const installUpdate = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(InstallUpdateInput))
  .handler(
    effectHandler(({ data }) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => installPlatformRelease(data.version))
        // The new binary carries the new migrations. It inherits the resolved DATABASE_URL, including
        // the running embedded PostgreSQL connection.
        const { code } = yield* Effect.promise(() => runCommand(process.execPath, ["migrate"]))
        if (code !== 0) return yield* Effect.die(new Error(`migrate exited with code ${code}`))
        return yield* Effect.promise(() => restartSystemdService(data.serviceName))
      }),
    ),
  )
