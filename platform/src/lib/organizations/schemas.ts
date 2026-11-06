import { Schema } from "effect"

import { SlugSchema } from "./slug.ts"

/** Every dashboard server function is addressed by the slug in the URL, never by an ID. */
export const OrganizationRouteInputSchema = Schema.Struct({ organizationSlug: SlugSchema })

export const IntegrationGuideStepSchema = Schema.Literals([
  "api-key",
  "install",
  "endpoint",
  "mount",
  "reply",
])
export type IntegrationGuideStep = typeof IntegrationGuideStepSchema.Type

/** Organization deletion purges this cache namespace's `<organizationId>:` keys. */
export const INTEGRATION_GUIDE_CACHE_NAMESPACE = "integration-guide"
