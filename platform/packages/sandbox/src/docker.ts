import { createHash } from "node:crypto"
import { hostname } from "node:os"
import process from "node:process"
import { dockerSandbox, type DockerSandboxConfig } from "@tanstack/ai-sandbox-docker"
import Dockerode from "dockerode"
import { SandboxConnection, dockerAvailable } from "./checks.ts"
import { sandboxLifecycle } from "./lifecycle.ts"

export class DockerSandbox extends SandboxConnection {
  constructor(config: DockerSandboxConfig) {
    super(
      () => {
        const provider = dockerSandbox(config)
        const docker = new Dockerode(config.dockerodeOptions)
        const resume = async (input: Parameters<typeof provider.resume>[0]) => {
          const handle = await provider.resume(input)
          if (handle) return handle
          try {
            await docker.getContainer(input.id).inspect()
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode === 404) return null
            throw error
          }
          throw new Error("Docker sandbox could not be resumed")
        }
        const destroy = async ({ id }: { id: string }) => {
          try {
            await docker.getContainer(id).remove({ force: true, v: true })
          } catch (error) {
            if ((error as { statusCode?: number }).statusCode !== 404) throw error
          }
        }
        return sandboxLifecycle(provider, {
          create: async (input) => {
            if (input.id === undefined) return provider.create(input)
            if (input.workspace?.source?.type === "local")
              throw new Error("Named Docker sandboxes do not support local workspace sources")
            input.signal?.throwIfAborted()
            await DockerSandbox.prepareImage(config.image, config.dockerodeOptions)
            const ports = config.publishPorts ?? []
            const container = await docker.createContainer({
              name: input.id,
              Image: config.image,
              Cmd: config.keepAliveCommand ?? ["sh", "-c", "tail -f /dev/null"],
              WorkingDir: config.workdir ?? "/workspace",
              Env: Object.entries(input.env ?? {}).map(([key, value]) => `${key}=${value}`),
              ExposedPorts: Object.fromEntries(ports.map((port) => [`${port}/tcp`, {}])),
              HostConfig: {
                PortBindings: Object.fromEntries(
                  ports.map((port) => [`${port}/tcp`, [{ HostPort: "" }]]),
                ),
                ...(config.hostGateway === false
                  ? {}
                  : { ExtraHosts: ["host.docker.internal:host-gateway"] }),
              },
            })
            try {
              await container.start()
              const handle = await resume({
                id: container.id,
                ...(input.signal ? { signal: input.signal } : {}),
              })
              if (!handle) throw new Error("Docker sandbox disappeared during creation")
              await handle.fs.mkdir(
                config.workdir ?? "/workspace",
                input.signal ? { signal: input.signal } : {},
              )
              return handle
            } catch (error) {
              await destroy({ id: container.id })
              throw error
            }
          },
          resume,
          destroy,
        })
      },
      async () => {
        const docker = new Dockerode({ ...config.dockerodeOptions, timeout: 15_000 })
        const { ID } = (await docker.info()) as { ID?: unknown }
        const { Components = [] } = (await docker.version()) as { Components?: { Name: string }[] }
        // Podman's compatibility API generates a new ID per request. Its native host remains the fallback.
        // https://github.com/containers/podman/blob/v6.0.2/pkg/api/handlers/compat/info.go#L82
        if (
          typeof ID === "string" &&
          ID &&
          !Components.some(({ Name }) => Name === "Podman Engine")
        )
          return `docker:${ID}`
        return `docker:${createHash("sha256")
          .update(
            JSON.stringify([
              hostname(),
              config.dockerodeOptions?.host,
              config.dockerodeOptions?.port,
              config.dockerodeOptions?.socketPath ?? process.env.DOCKER_HOST ?? "local",
            ]),
          )
          .digest("hex")}`
      },
    )
  }

  static override available(): Promise<boolean> {
    return dockerAvailable()
  }

  static async prepareImage(image: string, options?: Dockerode.DockerOptions): Promise<void> {
    const docker = new Dockerode(options)
    try {
      await docker.getImage(image).inspect()
      return
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error
    }
    const stream = await docker.pull(image)
    await new Promise<void>((resolve, reject) => {
      docker.modem.followProgress(stream, (error) => (error ? reject(error) : resolve()))
    })
  }
}
