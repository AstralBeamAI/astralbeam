import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationRouteAccess } from "@/lib/auth/organization-membership.server"
import { SlugSchema } from "@/lib/schemas"

export const getOrganizationRouteContext = createServerFn({ method: "GET" })
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ data }) => runDatabaseEffect(resolveOrganizationRouteAccess(data.organizationSlug)))
