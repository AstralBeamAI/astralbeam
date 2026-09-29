import { Schema } from "effect"

/**
 * An email the provider did not accept. `reason` is a short code, such as a provider error name,
 * that is safe to log, because provider messages can echo credentials or recipients.
 */
export class EmailDeliveryError extends Schema.TaggedError<EmailDeliveryError>()(
  "EmailDeliveryError",
  { reason: Schema.String },
  { httpApiStatus: 503 },
) {
  override readonly message = "The email could not be sent. Try again in a few minutes"
}

/** A failed provider connection test, carrying the provider's own message for the operator. */
export class EmailConnectionFailed extends Schema.TaggedError<EmailConnectionFailed>()(
  "EmailConnectionFailed",
  { message: Schema.String },
) {}
