import { and, eq, type SQL } from "drizzle-orm"
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core"
import * as Effect from "effect/Effect"

import { effectDatabase } from "@/db"

type SlugTable = AnyPgTable & { readonly slug: AnyPgColumn }

export function isSlugAvailable(input: {
  table: SlugTable
  slug: string
  scope?: SQL | undefined
}) {
  return Effect.flatMap(
    effectDatabase,
    (db) =>
      db.select({ slug: input.table.slug }).from(input.table).where(
        and(eq(input.table.slug, input.slug), input.scope),
      ).limit(1).pipe(Effect.map((rows) => rows.length === 0)),
  )
}
