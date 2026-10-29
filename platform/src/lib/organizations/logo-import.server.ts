import { and, eq, isNull, sql } from "drizzle-orm"
import { Effect } from "effect"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { organization } from "@/db/schema/organizations"
import { runAppEffect } from "@/lib/runtime/app-effect.server"
import organizationLogoImport from "@/lib/workflows/organization-logo-import"

export const queueOrganizationLogoImport = Effect.fn("queueOrganizationLogoImport")(
  function* (input: { organizationId: string }) {
    const db = yield* Database
    const [current] = yield* db
      .select({
        domain: organization.domain,
        updatedAt: sql<string>`${organization.updatedAt}::text`,
      })
      .from(organization)
      .where(and(eq(organization.id, input.organizationId), isNull(organization.logoFileId)))
      .pipe(mapDatabaseErrors())
    if (!current) return
    // Google S2 is an undocumented, best-effort favicon source. Missing icons return HTTP 404.
    const imageUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(current.domain)}&sz=128`
    yield* organizationLogoImport.execute(
      { ...input, updatedAt: current.updatedAt, imageUrl },
      { discard: true },
    )
  },
)

export async function enqueueOrganizationLogoImport(input: {
  organizationId: string
}): Promise<void> {
  // Loaded after creation commits, avoiding the Auth -> runtime -> Auth initialization cycle.
  const { provideClusterWorkflowEngine } = await import("@/lib/cluster/runtime")
  await runAppEffect(
    queueOrganizationLogoImport(input).pipe(
      provideClusterWorkflowEngine,
      Effect.catchCause(() =>
        Effect.logWarning("Could not schedule optional organization logo import"),
      ),
    ),
  )
}
