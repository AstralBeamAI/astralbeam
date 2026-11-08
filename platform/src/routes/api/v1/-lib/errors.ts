import { Schema } from "effect"

// Each message is written for the API caller who sees it, so the boundary exposes it verbatim.

const RestIssuesSchema = Schema.Array(
  Schema.Struct({ path: Schema.String, message: Schema.String }),
)

export class RestInvalidParameters extends Schema.TaggedError<
  RestInvalidParameters,
  { readonly brand: unique symbol }
>()("RestInvalidParameters", { issues: RestIssuesSchema }, { httpApiStatus: 400 }) {
  override readonly message = "Invalid request parameters."
}

export class RestQueryNotAccepted extends Schema.TaggedError<
  RestQueryNotAccepted,
  { readonly brand: unique symbol }
>()("RestQueryNotAccepted", {}, { httpApiStatus: 400 }) {
  override readonly message = "This endpoint does not accept query parameters."
}

/** Cursors are opaque, so a malformed, tampered, or wrong-scope cursor reads alike. */
export class RestInvalidCursor extends Schema.TaggedError<
  RestInvalidCursor,
  { readonly brand: unique symbol }
>()("RestInvalidCursor", {}, { httpApiStatus: 400 }) {
  override readonly message = "Invalid pagination cursor."
}

export class RestInvalidCredentials extends Schema.TaggedError<
  RestInvalidCredentials,
  { readonly brand: unique symbol }
>()("RestInvalidCredentials", {}, { httpApiStatus: 401 }) {
  override readonly message = "Invalid credentials."
}

export class RestMembershipRequired extends Schema.TaggedError<
  RestMembershipRequired,
  { readonly brand: unique symbol }
>()("RestMembershipRequired", {}, { httpApiStatus: 403 }) {
  override readonly message = "Organization membership is required."
}

export class RestRoleForbidden extends Schema.TaggedError<
  RestRoleForbidden,
  { readonly brand: unique symbol }
>()("RestRoleForbidden", {}, { httpApiStatus: 403 }) {
  override readonly message = "Your organization role does not permit this operation."
}

export class RestTenantAdminRequired extends Schema.TaggedError<
  RestTenantAdminRequired,
  { readonly brand: unique symbol }
>()("RestTenantAdminRequired", {}, { httpApiStatus: 403 }) {
  override readonly message = "Tenant administrator authority is required."
}

export class RestTenantTokenForbidden extends Schema.TaggedError<
  RestTenantTokenForbidden,
  { readonly brand: unique symbol }
>()("RestTenantTokenForbidden", {}, { httpApiStatus: 403 }) {
  override readonly message = "Tenant tokens cannot read the Organization."
}

export class RestResourceNotFound extends Schema.TaggedError<
  RestResourceNotFound,
  { readonly brand: unique symbol }
>()("RestResourceNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Resource not found."
}

export class RestOrganizationNotFound extends Schema.TaggedError<
  RestOrganizationNotFound,
  { readonly brand: unique symbol }
>()("RestOrganizationNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Organization not found."
}

export class RestUnsupportedMediaType extends Schema.TaggedError<
  RestUnsupportedMediaType,
  { readonly brand: unique symbol }
>()("RestUnsupportedMediaType", {}, { httpApiStatus: 415 }) {
  override readonly message = "Use application/json."
}

export class RestUnsupportedEncoding extends Schema.TaggedError<
  RestUnsupportedEncoding,
  { readonly brand: unique symbol }
>()("RestUnsupportedEncoding", {}, { httpApiStatus: 415 }) {
  override readonly message = "Content encoding is not supported."
}

export class RestInvalidBody extends Schema.TaggedError<
  RestInvalidBody,
  { readonly brand: unique symbol }
>()("RestInvalidBody", { issues: RestIssuesSchema }, { httpApiStatus: 422 }) {
  override readonly message = "Invalid request body."
}

export class RestRateLimited extends Schema.TaggedError<
  RestRateLimited,
  { readonly brand: unique symbol }
>()("RestRateLimited", { retryAfterSeconds: Schema.Int }, { httpApiStatus: 429 }) {
  override readonly message = "Request limit exceeded."
}

/** Every unexposed failure, answered with the reference its one server log entry carries. */
export class RestInternalError extends Schema.TaggedError<
  RestInternalError,
  { readonly brand: unique symbol }
>()("RestInternalError", { reference: Schema.String }, { httpApiStatus: 500 }) {
  override readonly message = "The request could not be completed."
}

export class RestSetupRequired extends Schema.TaggedError<
  RestSetupRequired,
  { readonly brand: unique symbol }
>()("RestSetupRequired", {}, { httpApiStatus: 503 }) {
  override readonly message = "Server configuration required."
  readonly retryAfterSeconds = 10
}
