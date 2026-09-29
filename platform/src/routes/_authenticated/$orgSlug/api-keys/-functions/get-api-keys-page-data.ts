import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { toValidationSchema, SlugSchema } from "@/lib/schemas"

export const getApiKeysPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ apiKey: ["read"] })])
  .validator(toValidationSchema(Schema.Struct({ organizationSlug: SlugSchema })))
  .handler(({ context }) => ({
    data: { organizationId: context.organizationId },
    permissions: context.permissions,
  }))
