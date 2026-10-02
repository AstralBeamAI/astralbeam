import { Schema } from "effect"

import { SlugSchema } from "./slug.ts"

/** Every dashboard server function is addressed by the slug in the URL, never by an ID. */
export const OrganizationRouteInputSchema = Schema.Struct({ organizationSlug: SlugSchema })
