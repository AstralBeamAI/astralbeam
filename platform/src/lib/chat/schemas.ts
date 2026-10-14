import * as Schema from "effect/Schema"

import { NonEmptyStringSchema, UuidV7Schema } from "@/lib/schemas"
import { UsageLimitIdSchema } from "@/lib/usage-limits/schemas"

const ChatExternalIdSchema = NonEmptyStringSchema.pipe(Schema.check(Schema.isMaxLength(255)))

const ChatTenantSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.JsonObject),
})

const ChatTenantUserSchema = Schema.Struct({
  id: ChatExternalIdSchema,
  name: Schema.optional(Schema.String),
  admin: Schema.optional(Schema.Boolean),
  metadata: Schema.optional(Schema.JsonObject),
})

export const ChatAuthTokenPayloadSchema = Schema.StructWithRest(
  Schema.Struct({
    ver: Schema.Literal(4),
    iat: Schema.Int,
    exp: Schema.Int,
    iss: UuidV7Schema,
    aud: Schema.Literal("astralbeam"),
    user: ChatTenantUserSchema,
    tenant: ChatTenantSchema,
    // Usage limits the host applies to this tenant user beyond the Organization's defaults.
    usage_limits: Schema.optional(
      Schema.Array(UsageLimitIdSchema).pipe(Schema.check(Schema.isMaxLength(20))),
    ),
  }),
  [Schema.JsonObject],
)
