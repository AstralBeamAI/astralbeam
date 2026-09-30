import { Schema } from "effect"

import { SlugSchema } from "./slug.ts"

/** Every dashboard server function is addressed by the slug in the URL, never by an ID. */
export const OrganizationRouteInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

export const OPENAI_API_KEY_VALIDATION_MESSAGE =
  "Enter an OpenAI API key, which starts with 'sk-' and contains no spaces"

// Shape only: every key OpenAI issues is one `sk-` token, so a pasted env line or project ID is
// refused here instead of failing every chat run. https://platform.openai.com/docs/api-reference/authentication
export const OpenaiApiKeySchema = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^sk-[\w-]{16,500}$/, {
      message: OPENAI_API_KEY_VALIDATION_MESSAGE,
    }),
  ),
)

export const isValidOpenaiApiKey = Schema.is(OpenaiApiKeySchema)
