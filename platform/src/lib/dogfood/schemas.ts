import * as Schema from "effect/Schema"

import { ApiKeyCredentialSchema } from "@/lib/api-keys/schemas"
import { isReservedOrganizationSlug } from "@/lib/organizations/reserved-slugs"
import { DisplayNameSchema, EmailAddressSchema, SlugSchema, UuidV7Schema } from "@/lib/schemas"

export const OwnerOnboardingInput = Schema.Struct({
  // Better Auth mails the owner's password-reset link, so its own address rules apply.
  email: EmailAddressSchema,
  organizationName: DisplayNameSchema,
  organizationSlug: SlugSchema.pipe(
    Schema.check(Schema.makeFilter((slug) => !isReservedOrganizationSlug(slug))),
  ),
})

const PendingOwnerOnboarding = Schema.Struct({
  ...OwnerOnboardingInput.fields,
  organizationId: Schema.optional(UuidV7Schema),
  apiKey: Schema.optional(ApiKeyCredentialSchema),
})

export type OwnerOnboarding = typeof OwnerOnboardingInput.Type
export type DogfoodOnboarding = OwnerOnboarding & {
  organizationCreated: boolean
  complete: boolean
}
export type PendingOnboarding = typeof PendingOwnerOnboarding.Type
export const PendingOwnerOnboardingJson = Schema.fromJsonString(PendingOwnerOnboarding)
