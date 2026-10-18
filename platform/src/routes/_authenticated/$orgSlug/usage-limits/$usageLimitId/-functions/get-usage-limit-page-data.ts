import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { UsageLimitPageInputSchema } from "../../-lib/schemas.ts"

/** Null when this organization has no such limit, which the loader turns into a 404 page. */
export const getUsageLimitPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(UsageLimitPageInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const usageLimits = yield* UsageLimits
        const input = { organizationId: context.organizationId, usageLimitId: data.usageLimitId }
        const { usageLimit, ...usage } = yield* usageLimits.subjects({ ...input, page: data.page })
        return { data: { usageLimit, usage }, permissions: context.permissions }
      }).pipe(Effect.catchTag("UsageLimitNotFound", () => Effect.succeed(null))),
      serverFnMeta.name,
    ),
  )
