import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"

import { runDatabaseEffect } from "@/db"
import { listOrganizationSandboxProviders } from "@/db/organization-sandbox-provider.server"
import { requireOrganizationConfigurationAccess } from "@/lib/auth/organization-configuration-access.server"
export const getOrganizationSandboxState = createServerFn({ method: "GET" }).handler(
  () =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const { organizationId } = yield* requireOrganizationConfigurationAccess("read")
        const sandboxProviders = yield* listOrganizationSandboxProviders(organizationId)
        return {
          organizationId,
          sandboxProviders,
        }
      }).pipe(
        Effect.catchTag("OrganizationConfigurationAccessError", () => Effect.succeed(null)),
      ),
    ),
)
