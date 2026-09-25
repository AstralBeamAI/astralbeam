import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { writeOrganizationOpenaiApiKey } from "@/db/organization-openai-api-key.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import {
  toStrictStandardSchema,
  isValidOpenaiApiKey,
  OPENAI_API_KEY_VALIDATION_MESSAGE,
  SlugSchema,
} from "@/lib/schemas"

export const updateOrganizationOpenaiApiKey = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    toStrictStandardSchema(
      Schema.Struct({
        organizationSlug: SlugSchema,
        /** `null` clears the stored key. */
        apiKey: Schema.NullOr(Schema.String),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    const apiKey = data.apiKey === null ? null : data.apiKey.trim()
    if (apiKey !== null && !isValidOpenaiApiKey(apiKey)) {
      return { ok: false as const, message: OPENAI_API_KEY_VALIDATION_MESSAGE }
    }
    await runDatabaseEffect(
      writeOrganizationOpenaiApiKey({ organizationId: context.organizationId, apiKey }),
    )
    return { ok: true as const }
  })
