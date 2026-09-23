import * as Schema from "effect/Schema"
import * as Option from "effect/Option"

import { SlugSchema, UuidV7Schema } from "@/lib/schemas"
import { isReservedOrganizationSlug } from "@/lib/auth/organization-slug"

const decodeDogfoodCredential = Schema.decodeUnknownOption(
  Schema.TemplateLiteralParser([
    "key_",
    UuidV7Schema,
    "_",
    UuidV7Schema,
    "_abo_",
    Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-z]{64}$/i))),
  ]),
)
export const DogfoodCredential = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => Option.isSome(decodeDogfoodCredential(value)))),
)

export const OwnerOnboardingInput = Schema.Struct({
  email: Schema.String.pipe(
    Schema.check(
      // Match Better Auth's z.email() before persisting onboarding. https://zod.dev/api#emails
      Schema.isPattern(/^(?!\.)(?!.+\.\.)[\w'+.-]*[\w+-]@(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/i),
      Schema.isMaxLength(254),
    ),
  ),
  organizationName: Schema.String.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isMinLength(1), Schema.isMaxLength(100)),
  ),
  organizationSlug: SlugSchema.pipe(
    Schema.check(Schema.makeFilter((slug) => !isReservedOrganizationSlug(slug))),
  ),
})

const PendingOwnerOnboarding = Schema.Struct({
  ...OwnerOnboardingInput.fields,
  requiresResetEmail: Schema.Boolean,
  organizationId: Schema.optional(UuidV7Schema),
  apiKey: Schema.optional(DogfoodCredential),
})

export type OwnerOnboarding = typeof OwnerOnboardingInput.Type
export type PendingOnboarding = typeof PendingOwnerOnboarding.Type
export const PendingOwnerOnboardingJson = Schema.fromJsonString(PendingOwnerOnboarding)
