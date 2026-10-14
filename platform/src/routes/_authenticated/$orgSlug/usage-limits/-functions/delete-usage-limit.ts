import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { UsageLimitVersionInputSchema } from "../-lib/schemas.ts"

export const deleteUsageLimit = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["delete"] })])
  .validator(toValidationSchema(UsageLimitVersionInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(UsageLimits, (usageLimits) =>
        usageLimits.remove({
          organizationId: context.organizationId,
          usageLimitId: data.usageLimitId,
          lockVersion: data.lockVersion,
        }),
      ).pipe(Effect.catchTag("UsageLimitChanged", exposeError)),
      serverFnMeta.name,
    ),
  )
