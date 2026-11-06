import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { effectHandler } from "@/lib/runtime/server-fn.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { getAvailableSandboxProviderIds } from "@/lib/sandboxes/availability.server"
import { toValidationSchema } from "@/lib/schemas"
import { SandboxProviderIdInputSchema } from "../../-lib/schemas.ts"

/** Null for a missing or foreign provider, which the page renders as not found. */
export const getSandboxProviderPageData = createServerFn({ method: "GET" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["read"] })])
  .validator(toValidationSchema(SandboxProviderIdInputSchema))
  .handler(
    effectHandler(({ context, data }) =>
      Effect.gen(function* () {
        const providers = yield* SandboxProviders
        const provider = yield* providers.get({
          organizationId: context.organizationId,
          id: data.sandboxProviderId,
        })
        if (provider === null) return null
        return {
          data: {
            provider,
            availableProviders: yield* Effect.promise(getAvailableSandboxProviderIds),
          },
          permissions: context.permissions,
        }
      }),
    ),
  )
