import { vercelSandbox, type VercelSandboxConfig } from "@tanstack/ai-sandbox-vercel"
import { SandboxConnection } from "./checks.ts"

export class VercelSandbox extends SandboxConnection {
  constructor(config: VercelSandboxConfig) {
    super(() => vercelSandbox(config))
  }
}
