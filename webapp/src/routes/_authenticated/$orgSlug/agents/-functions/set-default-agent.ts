import { createServerFn } from "@tanstack/react-start"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { setOrganizationDefaultAgent } from "@/db/agent.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { SetDefaultAgentInputSchema } from "../-lib/schemas.ts"

export const setDefaultAgent = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(Schema.toStandardSchemaV1(SetDefaultAgentInputSchema))
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
