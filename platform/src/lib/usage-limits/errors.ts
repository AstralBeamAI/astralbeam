import { Schema } from "effect"

// Each message is written for the member who sees it, so handlers may expose it verbatim.

export class UsageLimitNotFound extends Schema.TaggedError<UsageLimitNotFound>()(
  "UsageLimitNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Select a usage limit from this organization"
}

/** The limit's lock version moved on, or the limit no longer exists. */
export class UsageLimitChanged extends Schema.TaggedError<UsageLimitChanged>()(
  "UsageLimitChanged",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "This usage limit changed since you opened it. Reload and try again"
}

/** A limit that applies to the request has no allowance left until `usageLimit.resetsAt`. */
export class UsageLimitReached extends Schema.TaggedError<UsageLimitReached>()(
  "UsageLimitReached",
  {
    usageLimit: Schema.Struct({ name: Schema.String, resetsAt: Schema.String }),
    retryAfterSeconds: Schema.Int,
  },
  { httpApiStatus: 429 },
) {
  override get message() {
    return `${this.usageLimit.name} reached. It resets at ${this.usageLimit.resetsAt}.`
  }
}
