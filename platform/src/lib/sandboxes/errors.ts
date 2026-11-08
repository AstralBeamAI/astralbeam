import { Schema } from "effect"

import { type SandboxConnectionErrorCode, SandboxConnectionErrorCodeSchema } from "./schemas.ts"

// Each message is written for the member who sees it, so handlers may expose it verbatim.

export class SandboxProviderNotFound extends Schema.TaggedError<
  SandboxProviderNotFound,
  { readonly brand: unique symbol }
>()("SandboxProviderNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Select a sandbox provider from this organization"
}

export class SandboxProviderNameTaken extends Schema.TaggedError<
  SandboxProviderNameTaken,
  { readonly brand: unique symbol }
>()("SandboxProviderNameTaken", {}, { httpApiStatus: 409 }) {
  override readonly message = "A sandbox provider with this name already exists"
}

export class SandboxProviderInUse extends Schema.TaggedError<
  SandboxProviderInUse,
  { readonly brand: unique symbol }
>()("SandboxProviderInUse", {}, { httpApiStatus: 409 }) {
  override readonly message = "Reassign or delete agents using this provider before deleting it"
}

/** The provider's lock version moved on, or the provider no longer exists. */
export class SandboxProviderChanged extends Schema.TaggedError<
  SandboxProviderChanged,
  { readonly brand: unique symbol }
>()("SandboxProviderChanged", {}, { httpApiStatus: 409 }) {
  override readonly message =
    "This sandbox provider changed since you opened it. Reload and try again"
}

/** Stored credentials no longer decrypt or validate, so the member must enter them again. */
export class SandboxProviderUnreadable extends Schema.TaggedError<
  SandboxProviderUnreadable,
  { readonly brand: unique symbol }
>()("SandboxProviderUnreadable", {}, { httpApiStatus: 422 }) {
  override readonly message = "The stored credentials can't be read. Enter them again and save"
}

const SANDBOX_CONNECTION_FAILURE_MESSAGES = {
  cancelled: "The connection test was cancelled.",
  timeout: "The provider did not respond in time. Try again.",
  authentication: "The provider rejected the credentials. Check them and try again.",
  quota: "The provider's quota or rate limit was reached. Try again later.",
  not_found: "The provider could not find the configured image, snapshot, or template.",
  provider_error: "The provider connection test failed.",
  cleanup_failed: "The connection test's temporary sandbox could not be removed.",
} satisfies Record<SandboxConnectionErrorCode, string>

/** A save's connection test failed, so nothing was saved. */
export class SandboxConnectionFailed extends Schema.TaggedError<
  SandboxConnectionFailed,
  { readonly brand: unique symbol }
>()(
  "SandboxConnectionFailed",
  { errorCode: SandboxConnectionErrorCodeSchema },
  { httpApiStatus: 422 },
) {
  override get message() {
    return `${SANDBOX_CONNECTION_FAILURE_MESSAGES[this.errorCode]} Nothing was saved.`
  }
}

export class SandboxCleanupFailed extends Schema.TaggedError<
  SandboxCleanupFailed,
  { readonly brand: unique symbol }
>()("SandboxCleanupFailed", {}, { httpApiStatus: 422 }) {
  override readonly message =
    "The connection worked, but its temporary sandbox could not be removed"
}

/** The provider's adapter or configuration could not be loaded, without saying why. */
export class SandboxProviderUnavailable extends Schema.TaggedError<
  SandboxProviderUnavailable,
  { readonly brand: unique symbol }
>()("SandboxProviderUnavailable", { cause: Schema.Defect() }) {}
