import { createServerFn } from "@tanstack/react-start"
import { Effect, Schema } from "effect"

import { OrganizationOpenaiApiKeyInvalid } from "@/lib/organizations/errors"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { writeOrganizationOpenaiApiKey } from "@/lib/organizations/openai-api-key.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { isValidOpenaiApiKey } from "@/lib/organizations/schemas"
import { SlugSchema } from "@/lib/organizations/slug"
import { toValidationSchema } from "@/lib/schemas"

export const updateOrganizationOpenaiApiKey = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["update"] })])
  .validator(
    toValidationSchema(
      Schema.Struct({
        organizationSlug: SlugSchema,
        /** `null` clears the stored key. */
        apiKey: Schema.NullOr(Schema.String),
      }),
    ),
  )
  .handler(({ context, data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const apiKey = data.apiKey === null ? null : data.apiKey.trim()
        if (apiKey !== null && !isValidOpenaiApiKey(apiKey)) {
          return yield* new OrganizationOpenaiApiKeyInvalid()
        }
        yield* writeOrganizationOpenaiApiKey({ organizationId: context.organizationId, apiKey })
      }).pipe(Effect.catchTag("OrganizationOpenaiApiKeyInvalid", exposeError)),
      serverFnMeta.name,
    ),
  )
