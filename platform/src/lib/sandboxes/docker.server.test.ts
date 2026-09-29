import { Effect } from "effect"
import { expect, test, vi } from "vitest"

const docker = vi.hoisted(() => ({ containers: [] as object[], remove: vi.fn() }))

vi.mock("dockerode", () => ({
  default: class {
    listContainers = () => Promise.resolve(docker.containers)
    getContainer = (id: string) => ({ remove: () => Promise.resolve(docker.remove(id)) })
  },
}))

import { dockerKeepAliveCommand, removeOrphanedDockerSandboxes } from "./docker.server.ts"

// A sibling worktree's containers, or this process's live ones, must survive startup cleanup.
test("removes only this deployment's containers created before the process started", async () => {
  const before = Math.floor(performance.timeOrigin / 1_000) - 60
  const command = dockerKeepAliveCommand().join(" ")
  vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/sibling")
  const sibling = dockerKeepAliveCommand().join(" ")
  vi.unstubAllEnvs()
  docker.containers = [
    { Id: "orphan", Created: before, Command: command },
    { Id: "live", Created: Math.ceil(Date.now() / 1_000), Command: command },
    { Id: "sibling", Created: before, Command: sibling },
  ]

  await Effect.runPromise(removeOrphanedDockerSandboxes)

  expect(docker.remove.mock.calls).toEqual([["orphan"]])
})
