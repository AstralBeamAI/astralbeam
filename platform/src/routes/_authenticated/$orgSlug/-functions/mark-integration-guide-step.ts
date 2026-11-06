import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { Organizations } from "@/lib/organizations/organizations.server"
import {
  IntegrationGuideStepSchema,
  OrganizationRouteInputSchema,
} from "@/lib/organizations/schemas"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"

export const markIntegrationGuideStep = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        ...OrganizationRouteInputSchema.fields,
        step: IntegrationGuideStepSchema,
        marked: Schema.Boolean,
      }),
    ),
  )
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(Organizations, (organizations) =>
        organizations.markGuideStep({
          organizationId: context.organizationId,
          step: data.step,
          marked: data.marked,
        }),
      ),
      serverFnMeta.name,
    ),
  )
