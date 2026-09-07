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
        const counts = yield* readOrganizationResourceCounts(context.organizationId)
        return {
          data: { organizationName: context.organizationName, counts },
          permissions: context.permissions,
        }
      }),
    )
  )
