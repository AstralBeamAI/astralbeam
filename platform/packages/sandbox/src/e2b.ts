import { e2bSandbox, type E2BSandboxConfig } from "@tanstack/ai-sandbox-e2b"
import { SandboxConnection } from "./checks.ts"

export class E2BSandbox extends SandboxConnection {
  constructor(config: E2BSandboxConfig) {
    super(() => e2bSandbox(config))
  }
}
