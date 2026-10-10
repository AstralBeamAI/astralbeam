import { Schema } from "effect"

export class ChatThreadNotFound extends Schema.TaggedError<ChatThreadNotFound>()(
  "ChatThreadNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "This conversation is unavailable"
}

export class ChatThreadConflict extends Schema.TaggedError<ChatThreadConflict>()(
  "ChatThreadConflict",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "This conversation changed or is busy. Reload and try again"
}

export class ChatThreadForbidden extends Schema.TaggedError<ChatThreadForbidden>()(
  "ChatThreadForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Your conversation role does not allow this action"
}

export class ChatThreadInvalid extends Schema.TaggedError<ChatThreadInvalid>()(
  "ChatThreadInvalid",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "This conversation operation is invalid"
}

export class ChatSteeringFinished extends Schema.TaggedError<ChatSteeringFinished>()(
  "ChatSteeringFinished",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "This turn has finished. Queue your message as a new turn"
}

export class ChatIdentityNotSynchronized extends Schema.TaggedError<ChatIdentityNotSynchronized>()(
  "ChatIdentityNotSynchronized",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message =
    "Synchronize your identity with POST /api/v1/me before opening saved conversations"
}

export const ChatThreadErrorSchema = Schema.Union([
  ChatThreadNotFound,
  ChatThreadConflict,
  ChatThreadForbidden,
  ChatThreadInvalid,
  ChatSteeringFinished,
])
export type ChatThreadError = typeof ChatThreadErrorSchema.Type
