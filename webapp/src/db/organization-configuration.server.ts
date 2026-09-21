import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm"
import * as Effect from "effect/Effect"

import { effectDatabase } from "@/db"
import { apiKey } from "@/db/schema/organizations.server"

export function hasOrganizationApiKeys(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const rows = yield* db.select({ id: apiKey.id }).from(apiKey)
      .where(eq(apiKey.organizationId, organizationId)).limit(1)
    return rows.length > 0
  })
}

export function readOrganizationDefaultApiKey(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* effectDatabase
    const [key] = yield* db.select({ id: apiKey.id, key: apiKey.key }).from(apiKey).where(and(
      eq(apiKey.organizationId, organizationId),
      eq(apiKey.configId, "default"),
      eq(apiKey.enabled, true),
      or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, sql`now()`)),
    )).orderBy(asc(apiKey.createdAt), asc(apiKey.id)).limit(1)
    return key
  })
}
