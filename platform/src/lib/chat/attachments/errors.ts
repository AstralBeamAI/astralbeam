import { Schema } from "effect"

/** Thrown from fflate's filter, which can stop an unpack only by throwing. */
export class ChatOfficeArchiveTooLarge extends Schema.TaggedError<ChatOfficeArchiveTooLarge>()(
  "ChatOfficeArchiveTooLarge",
  {},
) {}
