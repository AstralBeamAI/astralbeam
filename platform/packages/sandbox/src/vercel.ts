import { vercelSandbox, VercelHandle, type VercelSandboxConfig } from "@tanstack/ai-sandbox-vercel"
import { APIError, Sandbox } from "@vercel/sandbox"
import { SandboxConnection } from "./checks.ts"
import { sandboxLifecycle } from "./lifecycle.ts"

export class VercelSandbox extends SandboxConnection {
  constructor(config: VercelSandboxConfig) {
    super(() => {
      const { workdir = "/vercel/sandbox", ...settings } = config
      // Vercel declares an unsupported snapshot property as undefined rather than optional.
      const handle = (sandbox: Sandbox): Omit<VercelHandle, "snapshot"> =>
        new VercelHandle({ sandbox, workdir, ports: config.ports ?? [] })
      return sandboxLifecycle(vercelSandbox(config), {
        create: async (input) => {
          const sandbox = await Sandbox.create({
            ...settings,
            runtime: config.runtime ?? "node24",
            ...(input.id ? { name: input.id } : {}),
            ...(input.env ? { env: input.env } : {}),
            ...(input.signal ? { signal: input.signal } : {}),
          })
          try {
            const result = await sandbox.runCommand({
              cmd: "mkdir",
              args: ["-p", workdir],
              ...(input.signal ? { signal: input.signal } : {}),
            })
            if (result.exitCode !== 0)
              throw new Error("Vercel sandbox workspace initialization failed")
            return handle(sandbox)
          } catch (error) {
            await sandbox.delete()
            throw error
          }
        },
        resume: async ({ id, signal }) => {
          try {
            return handle(
              await Sandbox.get({ ...settings, name: id, ...(signal ? { signal } : {}) }),
            )
          } catch (error) {
            if (error instanceof APIError && error.response.status === 404) return null
            throw error
          }
        },
        destroy: async ({ id, signal }) => {
          try {
            await (
              await Sandbox.get({ ...settings, name: id, ...(signal ? { signal } : {}) })
            ).delete(signal ? { signal } : {})
          } catch (error) {
            if (!(error instanceof APIError) || error.response.status !== 404) throw error
          }
        },
      })
    })
  }
}
