import { Schema } from "effect"

// Each message is written for the API caller who sees it, so the boundary exposes it verbatim.

const RestIssuesSchema = Schema.Array(
  Schema.Struct({ path: Schema.String, message: Schema.String }),
)

export class RestInvalidParameters extends Schema.TaggedError<RestInvalidParameters>()(
  "RestInvalidParameters",
  { issues: RestIssuesSchema },
  { httpApiStatus: 400 },
) {
  override readonly message = "Invalid request parameters."
}

export class RestQueryNotAccepted extends Schema.TaggedError<RestQueryNotAccepted>()(
  "RestQueryNotAccepted",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "This endpoint does not accept query parameters."
}

/** Cursors are opaque, so a malformed, tampered, or wrong-scope cursor reads alike. */
export class RestInvalidCursor extends Schema.TaggedError<RestInvalidCursor>()(
  "RestInvalidCursor",
  {},
  { httpApiStatus: 400 },
) {
  override readonly message = "Invalid pagination cursor."
}

export class RestInvalidCredentials extends Schema.TaggedError<RestInvalidCredentials>()(
  "RestInvalidCredentials",
  {},
  { httpApiStatus: 401 },
) {
  override readonly message = "Invalid credentials."
}

export class RestMembershipRequired extends Schema.TaggedError<RestMembershipRequired>()(
  "RestMembershipRequired",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Organization membership is required."
}

export class RestRoleForbidden extends Schema.TaggedError<RestRoleForbidden>()(
  "RestRoleForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Your organization role does not permit this operation."
}

export class RestTenantAdminRequired extends Schema.TaggedError<RestTenantAdminRequired>()(
  "RestTenantAdminRequired",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Tenant administrator authority is required."
}

export class RestTenantTokenForbidden extends Schema.TaggedError<RestTenantTokenForbidden>()(
  "RestTenantTokenForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Tenant tokens cannot read the Organization."
}

export class RestResourceNotFound extends Schema.TaggedError<RestResourceNotFound>()(
  "RestResourceNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Resource not found."
}

export class RestOrganizationNotFound extends Schema.TaggedError<RestOrganizationNotFound>()(
  "RestOrganizationNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Organization not found."
}

export class RestUnsupportedMediaType extends Schema.TaggedError<RestUnsupportedMediaType>()(
  "RestUnsupportedMediaType",
  {},
  { httpApiStatus: 415 },
) {
  override readonly message = "Use application/json."
}

export class RestUnsupportedEncoding extends Schema.TaggedError<RestUnsupportedEncoding>()(
  "RestUnsupportedEncoding",
  {},
  { httpApiStatus: 415 },
) {
  override readonly message = "Content encoding is not supported."
}

export class RestInvalidBody extends Schema.TaggedError<RestInvalidBody>()(
  "RestInvalidBody",
  { issues: RestIssuesSchema },
  { httpApiStatus: 422 },
) {
  override readonly message = "Invalid request body."
}

export class RestRateLimited extends Schema.TaggedError<RestRateLimited>()(
  "RestRateLimited",
  { retryAfterSeconds: Schema.Int },
  { httpApiStatus: 429 },
) {
  override readonly message = "Request limit exceeded."
}

/** Every unexposed failure, answered with the reference its one server log entry carries. */
export class RestInternalError extends Schema.TaggedError<RestInternalError>()(
  "RestInternalError",
  { reference: Schema.String },
  { httpApiStatus: 500 },
) {
  override readonly message = "The request could not be completed."
}

export class RestSetupRequired extends Schema.TaggedError<RestSetupRequired>()(
  "RestSetupRequired",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Server configuration required."
  readonly retryAfterSeconds = 10
}
