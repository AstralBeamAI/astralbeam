import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { catchOptimisticLockConflict } from "@/db/lib/optimistic-locking.server"
import {
  prepareOrganizationSandboxProviderCandidate,
  saveOrganizationSandboxProvider,
} from "@/db/organization-sandbox-provider.server"
import { requireOrganizationConfigurationAccess } from "@/lib/auth/organization-configuration-access.server"
import { OrganizationSandboxSaveInputSchema } from "../-lib/schemas.ts"
import { runOrganizationSandboxConnectionTest } from "../-lib/connection-test.server.ts"

export const saveOrganizationSandboxState = createServerFn({ method: "POST" })
  .validator(Schema.toStandardSchemaV1(OrganizationSandboxSaveInputSchema))
  .handler(({ data }) =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const { organizationId } = yield* requireOrganizationConfigurationAccess("update")
        const prepared = yield* prepareOrganizationSandboxProviderCandidate({
          organizationId,
          name: data.name,
          providerType: data.providerType,
          options: data.options,
          credentials: data.credentials,
          ...data.id && { id: data.id },
          ...data.lockVersion !== null && { lockVersion: data.lockVersion },
        })
        const connection = prepared.requiresTest
          ? yield* runOrganizationSandboxConnectionTest(prepared.candidate)
          : null
        if (connection?.status === "failure") {
          return {
            ok: false as const,
            code: connection.errorCode ?? "provider_error",
            message: connection.errorCode === "cleanup_failed"
              ? "The connection worked, but its temporary sandbox could not be removed"
              : "The provider connection test failed; the existing configuration was not changed",
          }
        }
        yield* saveOrganizationSandboxProvider(
          prepared,
          connection?.testedAt,
        )
        return { ok: true as const }
      }).pipe(
        catchOptimisticLockConflict("Reload before saving again"),
        Effect.catchTags({
          SandboxConfigurationValidationError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "invalid" as const,
              message: error.message,
            }),
          SandboxProviderNameConflictError: (error) =>
            Effect.succeed({
              ok: false as const,
              code: "duplicate_name" as const,
              message: error.message,
            }),
        }),
      ),
    )
  )
