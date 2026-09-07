import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import * as Schema from "effect/Schema"

import { getAuth } from "@/lib/auth.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SlugSchema } from "@/lib/schemas"

const OrganizationNameSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(100)),
)

export const updateOrganizationSettings = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({ organizationSlug: SlugSchema, name: OrganizationNameSchema }),
    ),
  )
  .handler(async ({ context, data }) => {
    const auth = await getAuth()
    // Better Auth owns the organization table and re-checks the caller's permission itself.
    await auth.api.updateOrganization({
      headers: getRequest().headers,
      body: { organizationId: context.organizationId, data: { name: data.name } },
    })
    return { ok: true as const }
  })
