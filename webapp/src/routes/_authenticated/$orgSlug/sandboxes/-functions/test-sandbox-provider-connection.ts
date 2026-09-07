import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import {
  catchOptimisticLockConflict,
  optimisticLockConflict,
} from "@/db/lib/optimistic-locking.server"
import {
  recordOrganizationSandboxProviderTest,
  resolveOrganizationSandboxProviderConfiguration,
} from "@/db/organization-sandbox-provider.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { runOrganizationSandboxConnectionTest } from "../-lib/connection-test.server.ts"
import { SandboxProviderInputSchema } from "../-lib/schemas.ts"

export const testSandboxProviderConnection = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["test"] })])
  .validator(Schema.toStandardSchemaV1(SandboxProviderInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const { organizationId } = context
        const resolved = yield* resolveOrganizationSandboxProviderConfiguration(
          organizationId,
          data.id,
        )
        if (resolved.lockVersion !== data.lockVersion) {
          return yield* optimisticLockConflict("Reload before testing again")
        }
        const connection = yield* runOrganizationSandboxConnectionTest(resolved)
        yield* recordOrganizationSandboxProviderTest({
          organizationId,
          id: data.id,
          lockVersion: data.lockVersion,
          status: connection.status,
          testedAt: connection.testedAt,
          ...connection.errorCode && { errorCode: connection.errorCode },
        })
        return connection.status === "success" ? { ok: true as const } : {
          ok: false as const,
          code: connection.errorCode ?? "provider_error",
          message: "The provider connection test failed",
        }
      }).pipe(
        catchOptimisticLockConflict("Reload before testing again"),
        Effect.catchTags({
          SandboxConfigurationValidationError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "invalid" as const,
              message: error.message,
            }),
        }),
      ),
    )
  )
