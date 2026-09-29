import { Schema } from "effect"

// Each message is written for the API caller who sees it, so the boundary exposes it verbatim.

export class ChatRunTooLarge extends Schema.TaggedError<ChatRunTooLarge>()(
  "ChatRunTooLarge",
  {},
  { httpApiStatus: 413 },
) {
  override readonly message = "The message and its attachments are too large."
}

export class ChatRunInputInvalid extends Schema.TaggedError<ChatRunInputInvalid>()(
  "ChatRunInputInvalid",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "The request body is not a valid chat run input."
}
