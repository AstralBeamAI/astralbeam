import { Schema } from "effect"

export class SupportRequestRateLimited extends Schema.TaggedError<
  SupportRequestRateLimited,
  { readonly brand: unique symbol }
>()("SupportRequestRateLimited", {}, { httpApiStatus: 429 }) {
  override readonly message = "Too many support requests. Please try again in an hour"
}
