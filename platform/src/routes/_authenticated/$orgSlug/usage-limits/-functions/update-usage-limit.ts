import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { UpdateUsageLimitInputSchema } from "../-lib/schemas.ts"

export const updateUsageLimit = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(UpdateUsageLimitInputSchema, strictParseOptions))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(UsageLimits, (usageLimits) =>
        usageLimits.update({
          organizationId: context.organizationId,
          usageLimitId: data.usageLimitId,
          lockVersion: data.lockVersion,
          fields: data.fields,
        }),
      ).pipe(Effect.catchTag("UsageLimitChanged", exposeError)),
      serverFnMeta.name,
    ),
  )
