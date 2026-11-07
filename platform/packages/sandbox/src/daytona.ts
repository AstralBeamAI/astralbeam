import {
  daytonaSandbox,
  DaytonaHandle,
  type DaytonaSandboxConfig,
} from "@tanstack/ai-sandbox-daytona"
import { Daytona, DaytonaNotFoundError } from "@daytona/sdk"
import { SandboxConnection } from "./checks.ts"
import { sandboxLifecycle } from "./lifecycle.ts"

export class DaytonaSandbox extends SandboxConnection {
  constructor(config: DaytonaSandboxConfig) {
    super(() => {
      const daytona = new Daytona(config)
      return sandboxLifecycle(daytonaSandbox(config), {
        resume: async ({ id }) => {
          try {
            const sandbox = await daytona.get(id)
            if (sandbox.state === "stopped" || sandbox.state === "archived") await sandbox.start()
            return new DaytonaHandle({
              sandbox,
              workdir: config.workdir ?? "/home/daytona/workspace",
              applyEnvSet: false,
            })
          } catch (error) {
            if (error instanceof DaytonaNotFoundError) return null
            throw error
          }
        },
        destroy: async ({ id }) => {
          try {
            await daytona.delete(await daytona.get(id))
          } catch (error) {
            if (!(error instanceof DaytonaNotFoundError)) throw error
          }
        },
      })
    })
  }
}
