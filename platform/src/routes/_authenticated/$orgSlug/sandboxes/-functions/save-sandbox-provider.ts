import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { SandboxProviders } from "@/lib/sandboxes/providers.server"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { SaveSandboxProviderInputSchema } from "../-lib/schemas.ts"

/** Tests changed connection settings before saving, and returns the provider's ID. */
export const saveSandboxProvider = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(toValidationSchema(SaveSandboxProviderInputSchema, strictParseOptions))
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(SandboxProviders, (providers) =>
        providers.save({
          organizationId: context.organizationId,
          name: data.name,
          providerType: data.providerType,
          options: data.options,
          credentials: data.credentials,
          id: data.id,
          lockVersion: data.lockVersion,
        }),
      ).pipe(
        Effect.catchTag(
          [
            "SandboxProviderChanged",
            "SandboxProviderNameTaken",
            "SandboxConnectionFailed",
            "SandboxCleanupFailed",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
