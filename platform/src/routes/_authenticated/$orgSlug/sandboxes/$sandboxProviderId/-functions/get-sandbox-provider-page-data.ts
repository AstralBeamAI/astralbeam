import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { runEffect } from "@/lib/runtime/server-fn.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { toValidationSchema } from "@/lib/schemas"
import { SandboxProviderIdInputSchema } from "../../-lib/schemas.ts"

/** Null for a missing or foreign provider, which the page renders as not found. */
export const getSandboxProviderPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(SandboxProviderIdInputSchema))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(SandboxProviders, (providers) =>
        providers.get({ organizationId: context.organizationId, id: data.sandboxProviderId }),
      ).pipe(
        Effect.map((provider) =>
          provider === null ? null : { data: { provider }, permissions: context.permissions },
        ),
      ),
      serverFnMeta.name,
    ),
  )
