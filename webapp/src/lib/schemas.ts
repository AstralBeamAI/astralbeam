import * as Schema from "effect/Schema"

import { SLUG_PATTERN } from "./slug.ts"

export const UuidV7Schema = Schema.String.pipe(Schema.check(Schema.isUUID(7)))

export const SlugSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => SLUG_PATTERN.test(value), {
      message: "Only lowercase letters and numbers are allowed",
    }),
  ),
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

export const ChatTenantUserSchema = Schema.StructWithRest(
  Schema.Struct({
    id: Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(255)),
    ),
  }),
  [Schema.JsonObject],
)

export const ChatTokenPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    ver: Schema.Literal(2),
    iat: Schema.Int,
    exp: Schema.Int,
    sub: Schema.String,
    tenantUser: ChatTenantUserSchema,
  }),
  [Schema.JsonObject],
)
