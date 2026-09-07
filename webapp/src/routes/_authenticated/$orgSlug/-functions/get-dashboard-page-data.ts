import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { readOrganizationResourceCounts } from "@/db/organization.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const getDashboardPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        // Counting only what this role may read makes the serialized payload the authorization
        // boundary, rather than the cards the browser chooses to render.
        const counts = yield* readOrganizationResourceCounts({
          organizationId: context.organizationId,
          permissions: context.permissions,
        })
        return { data: { organizationName: context.organizationName, counts } }
      }),
    )
  )
