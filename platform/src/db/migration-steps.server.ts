import type { Client } from "pg"

import type { BundledMigration } from "./migration-log.server.ts"
import { migrateOrganizationModelKeys } from "./migrations/20261001165317_migrate_organization_model_keys/data.server.ts"

export async function runMigrationStatements(
  client: Pick<Client, "query">,
  migration: BundledMigration,
) {
  if (migration.name === "20261001165317_migrate_organization_model_keys") {
    if (!migration.data) throw new Error("The model provider data migration source is missing")
    await migrateOrganizationModelKeys(client)
  } else if (migration.data !== undefined) {
    throw new Error(`No data migration is registered for '${migration.name}'`)
  }
  for (const statement of migration.sql.split("--> statement-breakpoint")) {
    await client.query(statement)
  }
}
