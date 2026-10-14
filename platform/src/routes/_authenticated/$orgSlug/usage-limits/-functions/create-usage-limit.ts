import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { CreateUsageLimitInputSchema } from "../-lib/schemas.ts"

/** Returns the new limit's public ID, which the caller navigates to. */
export const createUsageLimit = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(CreateUsageLimitInputSchema, strictParseOptions))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(UsageLimits, (usageLimits) =>
        usageLimits.create({ organizationId: context.organizationId, fields: data.fields }),
      ),
      serverFnMeta.name,
    ),
  )
