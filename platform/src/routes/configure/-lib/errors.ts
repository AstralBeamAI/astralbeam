import { Schema } from "effect"

export class ConfigureHttpsRequired extends Schema.TaggedError<
  ConfigureHttpsRequired,
  { readonly brand: unique symbol }
>()("ConfigureHttpsRequired", {}, { httpApiStatus: 400 }) {
  override readonly message = "HTTPS is required"
}

/** A mutation that is not a same-origin browser request. */
export class ConfigureRequestForbidden extends Schema.TaggedError<
  ConfigureRequestForbidden,
  { readonly brand: unique symbol }
>()("ConfigureRequestForbidden", {}, { httpApiStatus: 403 }) {
  override readonly message = "Forbidden"
}

export class OperatorSessionRequired extends Schema.TaggedError<
  OperatorSessionRequired,
  { readonly brand: unique symbol }
>()("OperatorSessionRequired", {}, { httpApiStatus: 403 }) {
  override readonly message = "Operator authentication required"
}

export class OperatorKeyInvalid extends Schema.TaggedError<
  OperatorKeyInvalid,
  { readonly brand: unique symbol }
>()("OperatorKeyInvalid", {}, { httpApiStatus: 401 }) {
  override readonly message = "Invalid encryption key"
}

export class OperatorLoginRateLimited extends Schema.TaggedError<
  OperatorLoginRateLimited,
  { readonly brand: unique symbol }
>()("OperatorLoginRateLimited", { retryAfterSeconds: Schema.Int }, { httpApiStatus: 429 }) {
  override get message() {
    return `Too many sign-in attempts; try again in ${this.retryAfterSeconds} seconds.`
  }
}
