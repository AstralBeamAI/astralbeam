import { Schema } from "effect"

export class SupportUnavailable extends Schema.TaggedError<SupportUnavailable>()(
  "SupportUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Support requests are not available right now"
}

export class SupportRequestRateLimited extends Schema.TaggedError<SupportRequestRateLimited>()(
  "SupportRequestRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message = "Too many support requests. Please try again in an hour"
}
