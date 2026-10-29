import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { queueOrganizationLogoImport } from "@/lib/workflows/organization-logo-import"

export async function enqueueOrganizationLogoImport(organizationId: string): Promise<void> {
  // Loaded after creation commits, avoiding the Auth -> runtime -> Auth initialization cycle.
  const { provideClusterWorkflowEngine } = await import("@/lib/cluster/runtime")
  await runAppEffect(
    queueOrganizationLogoImport(organizationId).pipe(
      provideClusterWorkflowEngine,
      Effect.catchCause(() =>
        Effect.logWarning("Could not schedule optional organization logo import"),
      ),
    ),
  )
}
