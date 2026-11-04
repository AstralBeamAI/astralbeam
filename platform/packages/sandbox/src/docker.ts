import { dockerSandbox, type DockerSandboxConfig } from "@tanstack/ai-sandbox-docker"
import Dockerode from "dockerode"
import { SandboxConnection, dockerAvailable } from "./checks.ts"

export class DockerSandbox extends SandboxConnection {
  constructor(config: DockerSandboxConfig) {
    super(() => dockerSandbox(config))
  }

  static override available(): Promise<boolean> {
    return dockerAvailable()
  }

  static async pullImage(image: string): Promise<void> {
    const docker = new Dockerode()
    const stream = await docker.pull(image)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()))
    })
  }
}
