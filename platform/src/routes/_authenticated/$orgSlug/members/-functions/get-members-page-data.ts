import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

export const getMembersPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware()])
  .validator(Schema.toStandardSchemaV1(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) => ({
    data: {
      organization: {
        id: context.organizationId,
        name: context.organizationName,
        slug: context.organizationSlug,
      },
      memberRole: context.role,
    },
    permissions: context.permissions,
  }))
