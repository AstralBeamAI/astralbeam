import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const getOrganizationSettingsPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) => ({
    data: {
      organization: {
        name: context.organizationName,
        slug: context.organizationSlug,
      },
    },
    permissions: context.permissions,
  }))
