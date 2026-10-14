import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { UsageLimitIdInputSchema } from "../../-lib/schemas.ts"

/** Null when this organization has no such limit, which the loader turns into a 404 page. */
export const getUsageLimitPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(UsageLimitIdInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(UsageLimits, (usageLimits) =>
        usageLimits.get({
          organizationId: context.organizationId,
          usageLimitId: data.usageLimitId,
        }),
      ).pipe(
        Effect.map((usageLimit) => ({ data: { usageLimit }, permissions: context.permissions })),
        Effect.catchTag("UsageLimitNotFound", () => Effect.succeed(null)),
      ),
      serverFnMeta.name,
    ),
  )
