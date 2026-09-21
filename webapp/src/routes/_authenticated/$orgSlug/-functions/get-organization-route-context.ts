import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationRouteAccess } from "@/lib/auth/organization-membership.server"
import { SlugSchema } from "@/lib/schemas"

export const getOrganizationRouteContext = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(async ({ data }) => {
    const access = await runDatabaseEffect(resolveOrganizationRouteAccess(data.organizationSlug))
    if (!access) return null
    const { getGlobalConfig } = await import("@/lib/config")
    return {
      ...access,
      canConfigure: access.organizationId === await getGlobalConfig("dogfood_organization_id") &&
        access.role.split(",").includes("owner"),
    }
  })
