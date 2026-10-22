import type { SandboxProvider } from "@tanstack/ai-sandbox"

/** Keep TanStack's implementation except for the lifecycle operations supplied here. */
export function sandboxLifecycle(
  provider: SandboxProvider,
  operations: Partial<Pick<SandboxProvider, "create" | "resume" | "destroy">>,
): SandboxProvider {
  return {
    name: provider.name,
    capabilities: () => provider.capabilities(),
    create: (input) => provider.create(input),
    resume: (input) => provider.resume(input),
    destroy: (input) => provider.destroy(input),
    ...(provider.restoreSnapshot
      ? { restoreSnapshot: provider.restoreSnapshot.bind(provider) }
      : {}),
    ...operations,
  }
}
