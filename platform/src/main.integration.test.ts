import { spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { Pool } from "pg"
import { expect, test } from "vitest"

import { parseDatabaseEncryptionKeyring } from "./db/lib/database-credentials.ts"
import { ConfigValuePayloadSchema } from "./db/schema/config.ts"
import { encryptDatabaseValue } from "./db/lib/encryption.ts"
import { Result } from "effect"

const configuredUrl = process.env.DATABASE_URL
const bootstrapDatabaseUrl =
  configuredUrl === "postgres://test:test@127.0.0.1:5432/test" ? undefined : configuredUrl
if (bootstrapDatabaseUrl) {
  const parsed = new URL(bootstrapDatabaseUrl)
  if (parsed.hostname !== "127.0.0.1" || !parsed.pathname.endsWith("_test"))
    throw new Error("Use a disposable loopback database ending in _test")
}

test.skipIf(!bootstrapDatabaseUrl)(
  "bootstrap preserves existing credentials and security defaults",
  async () => {
    const admin = new Pool({ connectionString: bootstrapDatabaseUrl })
    const name = `bootstrap_${randomUUID().replaceAll("-", "")}_test`
    const directory = mkdtempSync(join(tmpdir(), "astralbeam-bootstrap-"))
    const existingDirectory = mkdtempSync(join(tmpdir(), "astralbeam-bootstrap-existing-"))
    const url = new URL(bootstrapDatabaseUrl!)
    url.pathname = `/${name}`
    const database = new Pool({ connectionString: url.href })
    const encryptionKey = "bootstrap-integration-encryption-key-20261102"
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: url.href,
      DATABASE_ENCRYPTION_KEY: encryptionKey,
    }
    for (const key of [
      "BETTER_AUTH_SECRET",
      "TURNSTILE_SITE_KEY",
      "TURNSTILE_SECRET_KEY",
      "ALLOW_INSECURE",
      "SKIP_EMAIL_VERIFICATION",
    ])
      delete env[key]
    const bootstrap = (cwd: string) => {
      const environmentPath = join(cwd, ".env.local")
      const result = spawnSync(
        process.execPath,
        [
          ...(existsSync(environmentPath) ? [`--env-file=${environmentPath}`] : []),
          fileURLToPath(new URL("./main.ts", import.meta.url)),
          "bootstrap",
        ],
        {
          cwd,
          env,
          encoding: "utf8",
          timeout: 30_000,
        },
      )
      expect(result.status).toBe(0)
      return readFileSync(join(cwd, ".env.local"), "utf8")
    }
    try {
      await admin.query(`CREATE DATABASE "${name}"`)
      const fresh = bootstrap(directory)
      expect(fresh).toContain("SKIP_EMAIL_VERIFICATION=true")
      expect(fresh).toContain("ALLOW_INSECURE=true")
      expect(fresh).toContain("TURNSTILE_SITE_KEY=1x00000000000000000000AA")
      const stored = ["better_auth_secret", "turnstile_site_key", "turnstile_secret_key"]
      for (const key of stored) {
        const value = Result.getOrThrow(
          encryptDatabaseValue({
            value: { key, value: `existing-${key}-preserved-credential-20261102` },
            schema: ConfigValuePayloadSchema,
            keyring: parseDatabaseEncryptionKeyring(encryptionKey),
          }),
        )
        await database.query("INSERT INTO config(key, value) VALUES ($1, $2)", [key, value])
      }
      const before = (await database.query("SELECT key, value FROM config ORDER BY key")).rows
      const existing = bootstrap(existingDirectory)
      expect(existing).toContain("SKIP_EMAIL_VERIFICATION=false")
      expect(existing).toContain("ALLOW_INSECURE=false")
      for (const key of stored) expect(existing).not.toContain(`${key.toUpperCase()}=`)
      expect(bootstrap(existingDirectory)).toBe(existing)
      expect((await database.query("SELECT key, value FROM config ORDER BY key")).rows).toEqual(
        before,
      )
    } finally {
      await database.end()
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
      await admin.end()
      rmSync(directory, { recursive: true, force: true })
      rmSync(existingDirectory, { recursive: true, force: true })
    }
  },
  60_000,
)
