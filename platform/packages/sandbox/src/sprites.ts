import { spritesSandbox, type SpritesSandboxConfig } from "@tanstack/ai-sandbox-sprites"
import { SandboxConnection } from "./checks.ts"

export class SpritesSandbox extends SandboxConnection {
  constructor(config: SpritesSandboxConfig) {
    super(() => spritesSandbox(config))
  }
}
