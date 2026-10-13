import { spawnSync } from "node:child_process"
import process from "node:process"

export function worktreeHash(seed: string): number {
  // FNV-1a keeps suite ports stable without another dependency.
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

export function pinDockerHost(): void {
  // Match the CLI's active context so its probes and the sandbox client reach the same daemon.
  // https://docs.docker.com/engine/manage-resources/contexts/
  if (process.env.DOCKER_HOST) return
  const probe = spawnSync(
    "docker",
    ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8" },
  )
  if (probe.status === 0 && probe.stdout.trim()) process.env.DOCKER_HOST = probe.stdout.trim()
}
