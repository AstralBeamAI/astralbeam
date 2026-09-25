import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { resolveOrganizationRouteAccess } from "@/lib/auth/organization-membership.server"
import { toValidationSchema, SlugSchema } from "@/lib/schemas"

export const getOrganizationRouteContext = createServerFn({ method: "GET" })
  .validator(toValidationSchema(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ data }) => runDatabaseEffect(resolveOrganizationRouteAccess(data.organizationSlug)))
