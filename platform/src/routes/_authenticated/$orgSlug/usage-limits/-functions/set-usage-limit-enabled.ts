import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { UsageLimits } from "@/lib/usage-limits/usage-limits.server"
import { SetUsageLimitEnabledInputSchema } from "../-lib/schemas.ts"

export const setUsageLimitEnabled = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(SetUsageLimitEnabledInputSchema, strictParseOptions))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(UsageLimits, (usageLimits) =>
        usageLimits.setEnabled({
          organizationId: context.organizationId,
          usageLimitId: data.usageLimitId,
          lockVersion: data.lockVersion,
          enabled: data.enabled,
        }),
      ).pipe(Effect.catchTag("UsageLimitChanged", exposeError)),
      serverFnMeta.name,
    ),
  )
