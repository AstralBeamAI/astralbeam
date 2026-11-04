import { dockerSandbox, type DockerSandboxConfig } from "@tanstack/ai-sandbox-docker"
import { SandboxConnection, dockerAvailable } from "./checks.ts"

export class DockerSandbox extends SandboxConnection {
  constructor(config: DockerSandboxConfig) {
    super(() => dockerSandbox(config))
  }

  static override available(): Promise<boolean> {
    return dockerAvailable()
  }
}
