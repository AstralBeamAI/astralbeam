// Applies pending migrations and stores development defaults in the config table so a fresh local
// or CI database skips the /configure wizard. Production deployments should use /configure.
/// <reference lib="deno.ns" />
import { randomBytes } from "node:crypto"
import process from "node:process"

import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import postgres from "postgres"
import { loadEnv } from "vite"

const databaseUrl = process.env.DATABASE_URL ??
  loadEnv("development", new URL("..", import.meta.url).pathname, "").DATABASE_URL

if (!databaseUrl) throw new Error("DATABASE_URL is required")

const seedValues: Record<string, unknown> = {
  app_base_url: process.env.APP_BASE_URL ?? "http://localhost:3000",
  better_auth_secret: randomBytes(32).toString("base64url"),
  setup_completed: true,
}

const client = postgres(databaseUrl, { max: 1 })
const db = drizzle({ client })

const migrationResult = await migrate(db, {
  migrationsFolder: new URL("../src/db/migrations", import.meta.url).pathname,
})
if (migrationResult) throw new Error(`Migrations failed: ${migrationResult.exitCode}`)

for (const [key, value] of Object.entries(seedValues)) {
  // Existing values win so reseeding never overwrites deliberate local configuration.
  await db.execute(sql`
    insert into config ("key", "value", "updated_by")
    values (${key}, ${JSON.stringify(value)}::jsonb, 'seed-config')
    on conflict ("key") do nothing
  `)
}

await client.end()
console.log("Database migrated and development config seeded; adjust it anytime at /configure.")
