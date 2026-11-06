import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { toValidationSchema } from "@/lib/schemas"
import { SandboxProviderInputSchema } from "../-lib/schemas.ts"

/** Returns the recorded outcome, which is a failure result rather than an error when it fails. */
export const testSandboxProviderConnection = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["test"] })])
  .validator(toValidationSchema(SandboxProviderInputSchema))
  .handler(
    effectHandler(({ context, data }) =>
      Effect.flatMap(SandboxProviders, (providers) =>
        providers.testConnection({
          organizationId: context.organizationId,
          id: data.id,
          lockVersion: data.lockVersion,
        }),
      ).pipe(Effect.catchTag(["SandboxProviderChanged", "SandboxProviderUnreadable"], exposeError)),
    ),
  )
