import * as Schema from "effect/Schema"

import { SLUG_PATTERN, SLUG_VALIDATION_MESSAGE } from "./slug.ts"

export const UuidV7Schema = Schema.String.pipe(Schema.check(Schema.isUUID(7)))

export const SlugSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(SLUG_PATTERN, { message: SLUG_VALIDATION_MESSAGE })),
)

export const AgentNameSchema = Schema.String.pipe(
  Schema.check(Schema.isTrimmed()),
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(100)),
)

export const AgentSystemPromptSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(32_768)),
)

export const LockVersionSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0)),
)

const ChatExternalIdSchema = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(255)),
)

const ChatTenantSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.JsonObject),
})

export const ChatTenantUserSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  tenant: ChatTenantSchema,
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.JsonObject),
})

export const ChatTokenPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    ver: Schema.Literal(3),
    iat: Schema.Int,
    exp: Schema.Int,
    iss: SlugSchema,
    aud: Schema.Literal("astralbeam"),
    tenantUser: ChatTenantUserSchema,
  }),
  [Schema.JsonObject],
)
