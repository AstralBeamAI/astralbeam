import { e2bSandbox, INSTANCE_KEY_METADATA, type E2BSandboxConfig } from "@tanstack/ai-sandbox-e2b"
import { Sandbox } from "e2b"
import { SandboxConnection } from "./checks.ts"
import { sandboxLifecycle } from "./lifecycle.ts"

export class E2BSandbox extends SandboxConnection {
  constructor(config: E2BSandboxConfig) {
    super(() => {
      const provider = e2bSandbox(config)
      const resolveId = async (id: string, signal?: AbortSignal) => {
        const [sandbox] = await Sandbox.list({
          ...config,
          query: { metadata: { [INSTANCE_KEY_METADATA]: id } },
          limit: 1,
        }).nextItems(signal ? { signal } : {})
        return sandbox?.sandboxId ?? id
      }
      return sandboxLifecycle(provider, {
        resume: async ({ id, signal }) =>
          provider.resume({ id: await resolveId(id, signal), ...(signal ? { signal } : {}) }),
        destroy: async ({ id, signal }) =>
          provider.destroy({ id: await resolveId(id, signal), ...(signal ? { signal } : {}) }),
      })
    })
  }
}
