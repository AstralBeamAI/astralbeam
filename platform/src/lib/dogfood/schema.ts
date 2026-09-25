import * as Schema from "effect/Schema"
import * as Option from "effect/Option"

import { NonEmptyStringSchema, SlugSchema, UuidV7Schema } from "@/lib/schemas"
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
  Schema.check(
    Schema.makeFilter((value) => Option.isSome(decodeDogfoodCredential(value)), {
      message: "Must be a valid embedded assistant credential",
    }),
  ),
)

export const OwnerOnboardingInput = Schema.Struct({
  email: Schema.String.pipe(
    Schema.check(
      // Match Better Auth's z.email() before persisting onboarding. https://zod.dev/api#emails
      Schema.isPattern(/^(?!\.)(?!.+\.\.)[\w'+.-]*[\w+-]@(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,}$/i),
      Schema.isMaxLength(254),
    ),
  ),
  organizationName: NonEmptyStringSchema.pipe(
    Schema.check(Schema.isTrimmed(), Schema.isMaxLength(100)),
  ),
  organizationSlug: SlugSchema.pipe(
    Schema.check(Schema.makeFilter((slug) => !isReservedOrganizationSlug(slug))),
  ),
})

const PendingOwnerOnboarding = Schema.Struct({
  ...OwnerOnboardingInput.fields,
  organizationId: Schema.optional(UuidV7Schema),
  apiKey: Schema.optional(DogfoodCredential),
})

export type OwnerOnboarding = typeof OwnerOnboardingInput.Type
export type DogfoodOnboarding = OwnerOnboarding & {
  organizationCreated: boolean
  complete: boolean
}
export type PendingOnboarding = typeof PendingOwnerOnboarding.Type
export const PendingOwnerOnboardingJson = Schema.fromJsonString(PendingOwnerOnboarding)
