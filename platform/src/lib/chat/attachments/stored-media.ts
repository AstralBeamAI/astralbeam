import { Schema } from "effect"

import { APP_HANDLE } from "../../constants.ts"
import { UuidV7Schema } from "../../schemas.ts"

export const StoredChatSourceSchema = Schema.Struct({
  type: Schema.Literal("file"),
  provider: Schema.Literal(APP_HANDLE),
  value: UuidV7Schema,
  mimeType: Schema.optionalKey(Schema.String),
})

export function storedChatMediaSource(part: typeof Schema.JsonObject.Type) {
  return Schema.decodeUnknownOption(StoredChatSourceSchema)(part.source)
}

export function chatMediaPart(part: typeof Schema.JsonObject.Type): boolean {
  return ["image", "document", "audio", "video"].includes(
    typeof part.type === "string" ? part.type : "",
  )
}
