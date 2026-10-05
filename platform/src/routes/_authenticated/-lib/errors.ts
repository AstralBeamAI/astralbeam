import { Schema } from "effect"

export class SupportRequestRateLimited extends Schema.TaggedError<SupportRequestRateLimited>()(
  "SupportRequestRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message = "Too many support requests. Please try again in an hour"
}
