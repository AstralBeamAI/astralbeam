import { Schema } from "effect"

/** Thrown from fflate's filter, which can stop an unpack only by throwing. */
export class ChatOfficeArchiveTooLarge extends Schema.TaggedError<ChatOfficeArchiveTooLarge>()(
  "ChatOfficeArchiveTooLarge",
  {},
) {}

export class UploadNotFound extends Schema.TaggedError<UploadNotFound>()(
  "UploadNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Upload not found"
}
export class UploadConflict extends Schema.TaggedError<UploadConflict>()(
  "UploadConflict",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "The upload cannot perform this operation"
}
export class UploadClaimed extends Schema.TaggedError<UploadClaimed>()(
  "UploadClaimed",
  {},
  { httpApiStatus: 409 },
) {
  readonly type = "urn:file-upload:claimed"
  override readonly message = "The uploaded file belongs to a conversation"
}
export class UploadInvalid extends Schema.TaggedError<UploadInvalid>()(
  "UploadInvalid",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "The uploaded file failed validation"
}
export class UploadRateLimited extends Schema.TaggedError<UploadRateLimited>()(
  "UploadRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message = "Too many uploads. Try again later."
}
