import { createServerFn } from "@tanstack/react-start"
import * as Schema from "effect/Schema"

import { runDatabaseEffect } from "@/db"
import { writeOrganizationOpenaiApiKey } from "@/db/organization-openai-api-key.server"
import { organizationAccessMiddleware } from "@/lib/auth/organization-middleware"
import { isValidOpenaiApiKey, OPENAI_API_KEY_VALIDATION_MESSAGE, SlugSchema } from "@/lib/schemas"

export const updateOrganizationOpenaiApiKey = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    Schema.toStandardSchemaV1(
      Schema.Struct({
        organizationSlug: SlugSchema,
        /** `null` clears the stored key. */
        apiKey: Schema.NullOr(Schema.String),
      }),
    ),
  )
  .handler(async ({ context, data }) => {
    const apiKey = data.apiKey === null ? null : data.apiKey.trim()
    // The submitted value is a secret, so the shape is checked here rather than in the validator,
    // whose failures carry the rejected input.
    if (apiKey !== null && !isValidOpenaiApiKey(apiKey)) {
      return { ok: false as const, message: OPENAI_API_KEY_VALIDATION_MESSAGE }
    }
    await runDatabaseEffect(
      writeOrganizationOpenaiApiKey({ organizationId: context.organizationId, apiKey }),
    )
    return { ok: true as const }
  })
