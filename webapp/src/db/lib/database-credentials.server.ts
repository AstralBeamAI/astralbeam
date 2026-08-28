import { Buffer } from "node:buffer"
import { createHash } from "node:crypto"
import process from "node:process"

import { Schema } from "effect"

export type DatabaseKeyringEntry = {
  readonly kid: string
  readonly root: Uint8Array
}

export type DatabaseEncryptionKeyring = readonly [
  DatabaseKeyringEntry,
  ...DatabaseKeyringEntry[],
]

const decodeDatabaseUrl = Schema.decodeUnknownSync(Schema.NonEmptyString)

let databaseUrl: string | undefined

export function getDatabaseUrl(): string {
  if (databaseUrl) return databaseUrl
  try {
    return databaseUrl = decodeDatabaseUrl(process.env.DATABASE_URL)
  } catch (error) {
    if (!Schema.isSchemaError(error)) throw error
    throw new Error("'DATABASE_URL' environment variable is not set")
  }
}

function databaseKeyringEntry(secret: string): DatabaseKeyringEntry {
  const root = createHash("sha256").update(secret, "utf8").digest()
  // RFC 7638 thumbprints provide stable, non-secret key IDs for authenticated JWE selection.
  // https://www.rfc-editor.org/rfc/rfc7638
  const canonicalJwk = JSON.stringify({ k: Buffer.from(root).toString("base64url"), kty: "oct" })
  return {
    kid: createHash("sha256").update(canonicalJwk, "utf8").digest("base64url"),
    root,
  }
}

export function parseDatabaseEncryptionKeyring(value: unknown): DatabaseEncryptionKeyring {
  if (typeof value !== "string") throw invalidDatabaseEncryptionKey()
  const secrets = value.split(",").map((secret) => secret.trim())
  if (
    secrets.some((secret) => secret.length < 32 || secret.length > 1_024) ||
    new Set(secrets).size !== secrets.length
  ) {
    throw invalidDatabaseEncryptionKey()
  }
  const [active, ...fallbacks] = secrets.map(databaseKeyringEntry)
  if (!active) throw invalidDatabaseEncryptionKey()
  return [active, ...fallbacks]
}

function invalidDatabaseEncryptionKey(): Error {
  return new Error(
    "DATABASE_ENCRYPTION_KEY must be a comma-separated list of unique secrets containing 32 to 1,024 characters each",
  )
}

let keyring: DatabaseEncryptionKeyring | undefined

// Environment changes require a restart; key metadata is derived only once per process.
export function getDatabaseEncryptionKeyring(): DatabaseEncryptionKeyring {
  return keyring ??= parseDatabaseEncryptionKeyring(process.env.DATABASE_ENCRYPTION_KEY)
}

export function getActiveDatabaseEncryptionRoot(): Uint8Array {
  return getDatabaseEncryptionKeyring()[0].root
}

type DatabaseBootstrapVariable = "DATABASE_URL" | "DATABASE_ENCRYPTION_KEY"
let bootstrapIssues: readonly DatabaseBootstrapVariable[] | undefined

export function getDatabaseBootstrapIssues(): readonly DatabaseBootstrapVariable[] {
  if (bootstrapIssues) return bootstrapIssues
  const issues: DatabaseBootstrapVariable[] = []
  try {
    getDatabaseUrl()
  } catch {
    issues.push("DATABASE_URL")
  }
  try {
    getDatabaseEncryptionKeyring()
  } catch {
    issues.push("DATABASE_ENCRYPTION_KEY")
  }
  return bootstrapIssues = issues
}
