import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"

import { runDatabaseEffect } from "@/db"
import { readOrganizationAgentState } from "@/db/agent.server"
import { requireOrganizationConfigurationAccess } from "@/lib/auth/organization-configuration-access.server"

export const getOrganizationAgentState = createServerFn({ method: "GET" }).handler(
  () =>
    runDatabaseEffect(
      Effect.gen(function* () {
        const { organizationId } = yield* requireOrganizationConfigurationAccess("read")
        const state = yield* readOrganizationAgentState(organizationId)
        return { organizationId, ...state }
      }).pipe(
        Effect.catchTag("OrganizationConfigurationAccessError", () => Effect.succeed(null)),
      ),
    ),
)
