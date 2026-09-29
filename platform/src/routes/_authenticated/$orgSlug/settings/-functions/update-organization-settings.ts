import { createServerFn } from "@tanstack/react-start"
import { getRequest } from "@tanstack/react-start/server"
import { Effect, Schema } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { DisplayNameSchema, SlugSchema, toValidationSchema } from "@/lib/schemas"

export const updateOrganizationSettings = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organization: ["update"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        organizationSlug: SlugSchema,
        name: DisplayNameSchema,
        slug: SlugSchema,
      }),
    ),
  )
  .handler(({ context, data, serverFnMeta }) => {
    const headers = getRequest().headers
    return runEffect(
      Effect.flatMap(Auth, (auth) =>
        auth.updateOrganization({
          headers,
          organizationId: context.organizationId,
          name: data.name,
          slug: data.slug,
        }),
      ).pipe(Effect.catchTag("OrganizationSlugTaken", exposeError)),
      serverFnMeta.name,
    )
  })
