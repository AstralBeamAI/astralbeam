import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { setOrganizationDefaultAgent } from "@/db/agent.server"
import { organizationConfigurationAccessMiddleware } from "@/lib/auth/organization-configuration-middleware"
import { SetOrganizationDefaultAgentInputSchema } from "../-lib/schemas.ts"

export const setOrganizationDefaultAgentState = createServerFn({ method: "POST" })
  .middleware([organizationConfigurationAccessMiddleware("update")])
  .validator(Schema.toStandardSchemaV1(SetOrganizationDefaultAgentInputSchema))
  .handler(({ context, data }) =>
    runDatabaseEffect(
      setOrganizationDefaultAgent({ organizationId: context.organizationId, id: data.id }).pipe(
        Effect.as({ ok: true as const }),
        Effect.catchTag("OrganizationDefaultAgentError", (error) =>
          Effect.succeed({
            ok: false as const,
            code: "invalid_agent" as const,
            message: error.message,
          })),
      ),
    )
  )
