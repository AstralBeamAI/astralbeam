import process from "node:process"
import { fileURLToPath } from "node:url"
import { Command, Option } from "commander"
import { and, asc, eq, gt, sql } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { loadEnv } from "vite"

import { closeDatabase, Database } from "../src/db/database.server.ts"
import { mapDatabaseErrors } from "../src/db/lib/sqlstate.server.ts"
import { user } from "../src/db/schema/authentication.server.ts"
import { fileObject, organizationLogo, userAvatar } from "../src/db/schema/files.server.ts"
import { organization } from "../src/db/schema/organizations.server.ts"
import { ProfileFiles } from "../src/lib/storage/profile-files.server.ts"
import { ChatFiles } from "../src/lib/chat/attachments/chat-files.server.ts"
import { isChatMigrationTable, migrateChatFiles } from "../src/lib/storage/chat-migration.server.ts"
import { StoredFiles } from "../src/lib/storage/stored-files.server.ts"

import { ChatSandboxes } from "../src/lib/chat/sandbox/sandbox.server.ts"
import { migrateSandboxArtifacts } from "../src/lib/storage/artifact-migration.server.ts"

const environment = loadEnv("development", fileURLToPath(new URL("../", import.meta.url)), "")
for (const [name, value] of Object.entries(environment))
  if (process.env[name] === undefined) process.env[name] = value

const command = new Command()
  .description("Inventory, migrate, and verify database-backed files in operator storage.")
  .argument("<mode>", "inventory, migrate, or verify")
  .addOption(
    new Option("--table <table>", "Select a source table, default all supported tables").choices([
      "user.image",
      "organization.logo",
      "chat_message_part.payload",
      "chat_message.metadata.modelMessages",
      "cache_entry.value",
      "sandbox_artifacts",
    ]),
  )
  .option(
    "--writers-stopped",
    "Confirm application writers and file maintenance runners are stopped",
  )
  .parse()
const mode = command.args[0]
if (!["inventory", "migrate", "verify"].includes(mode!))
  command.error("Use inventory, migrate, or verify.")
const options = command.opts<{ table?: string; writersStopped?: boolean }>()
if (mode === "migrate" && !options.writersStopped)
  command.error(
    "Stop application writers and file maintenance runners, then pass --writers-stopped.",
  )

const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    Database.layer,
    ProfileFiles.layer,
    StoredFiles.layer,
    ChatFiles.layer,
    ChatSandboxes.layer,
  ),
)
try {
  await runtime.runPromise(
    Effect.gen(function* () {
      const db = yield* Database
      const profiles = yield* ProfileFiles
      const files = yield* StoredFiles
      for (const tableName of options.table
        ? [options.table]
        : [
            "user.image",
            "organization.logo",
            "chat_message_part.payload",
            "chat_message.metadata.modelMessages",
            "cache_entry.value",
            "sandbox_artifacts",
            "sandbox_artifacts",
          ]) {
        if (tableName === "sandbox_artifacts") {
          yield* migrateSandboxArtifacts(mode as "inventory" | "migrate" | "verify")
          continue
        }
        if (isChatMigrationTable(tableName)) {
          yield* migrateChatFiles(tableName, mode as "inventory" | "migrate" | "verify")
          continue
        }
        const isAvatar = tableName === "user.image"
        const table = isAvatar ? user : organization
        const column = isAvatar ? user.image : organization.logo
        const [inventory] = yield* db
          .select({
            total: sql<number>`count(*)::integer`,
            embedded: sql<number>`count(*) filter (where ${column} like 'data:%')::integer`,
            external: sql<number>`count(*) filter (where ${column} is not null and ${column} not like 'data:%' and ${column} not like '/api/files/%')::integer`,
            stored: sql<number>`count(*) filter (where ${column} like '/api/files/%')::integer`,
            empty: sql<number>`count(*) filter (where ${column} is null)::integer`,
          })
          .from(table)
          .pipe(mapDatabaseErrors())
        console.log(tableName, inventory)
        if (mode === "inventory") continue
        const counts = { migrated: 0, unavailable: 0, unchanged: 0, verified: 0 }
        let cursor: string | undefined
        while (true) {
          const rows = yield* db
            .select({
              id: table.id,
              source: column,
              email: isAvatar ? user.email : sql<string>`null`,
            })
            .from(table)
            .where(cursor ? gt(table.id, cursor) : undefined)
            .orderBy(asc(table.id))
            .limit(100)
            .pipe(mapDatabaseErrors())
          if (!rows.length) break
          for (const row of rows) {
            if (mode === "migrate") {
              const result = yield* profiles
                .migrate({ kind: isAvatar ? "avatar" : "logo", id: row.id }, row.source, row.email)
                .pipe(
                  Effect.tapError((error) =>
                    Effect.sync(() =>
                      console.error(
                        `Stopped at ${tableName} ${row.id}: ${error._tag}. Source data is retained.`,
                      ),
                    ),
                  ),
                )
              counts[result] += 1
              console.log(`${tableName} ${row.id}: ${result}`)
            } else if (row.source) {
              if (isAvatar) yield* profiles.validateAvatar(row.id, row.source)
              else yield* profiles.validateLogo(row.id, row.source)
              const association = isAvatar ? userAvatar : organizationLogo
              const ownerId = isAvatar ? userAvatar.userId : organizationLogo.organizationId
              const [stored] = yield* db
                .select({ file: fileObject })
                .from(association)
                .innerJoin(fileObject, eq(fileObject.id, association.id))
                .where(
                  and(
                    eq(ownerId, row.id),
                    sql`${row.source} = ${isAvatar ? sql`'/api/files/avatars/' || ${association.id}` : sql`'/api/files/organizations/' || ${row.id} || '/logos/' || ${association.id}`}`,
                  ),
                )
                .pipe(mapDatabaseErrors())
              if (!stored || !stored.file.verifiedAt || stored.file.expiresAt)
                return yield* Effect.die(new Error(`Unclaimed file: ${tableName} ${row.id}`))
              yield* files.read(stored.file)
              counts.verified += 1
            }
          }
          cursor = rows.at(-1)!.id
        }
        console.log(tableName, counts)
      }
    }),
  )
} finally {
  await runtime.dispose()
  await closeDatabase()
}
