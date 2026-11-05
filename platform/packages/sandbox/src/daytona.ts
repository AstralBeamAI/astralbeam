import { daytonaSandbox, type DaytonaSandboxConfig } from "@tanstack/ai-sandbox-daytona"
import { SandboxConnection } from "./checks.ts"

export class DaytonaSandbox extends SandboxConnection {
  constructor(config: DaytonaSandboxConfig) {
    super(() => daytonaSandbox(config))
  }
}
