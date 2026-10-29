import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"
import { eq } from "drizzle-orm"

import { Database } from "@/db/database"
import { mapDatabaseErrors } from "@/db/lib/sqlstate"
import { organization } from "@/db/schema/organizations"

import { Config } from "@/lib/config/config"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { OrganizationNotFound } from "@/lib/organizations/errors"
import { OrganizationRouteInputSchema } from "@/lib/organizations/schemas"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(toValidationSchema(OrganizationRouteInputSchema))
  .handler(({ context, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const db = yield* Database
        const [profile] = yield* db
          .select({ domain: organization.domain, logoFileId: organization.logoFileId })
          .from(organization)
          .where(eq(organization.id, context.organizationId))
          .pipe(mapDatabaseErrors())
        if (!profile) return yield* new OrganizationNotFound()
        const dogfoodOrganizationId = yield* Effect.flatMap(Config, (config) =>
          config.get("dogfood_organization_id"),
        )
        return {
          data: {
            organization: {
              id: context.organizationId,
              name: context.organizationName,
              slug: context.organizationSlug,
              domain: profile.domain,
              logoFileId: profile.logoFileId,
              dogfood: dogfoodOrganizationId === context.organizationId,
            },
          },
          permissions: context.permissions,
        }
      }).pipe(Effect.catchTag("OrganizationNotFound", exposeError)),
      serverFnMeta.name,
    ),
  )
