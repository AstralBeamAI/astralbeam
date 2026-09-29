import { Schema } from "effect"

// Each message is written for the API caller who sees it, so handlers may expose it verbatim.

/** Missing and out-of-scope Tenants read alike, so the reply cannot confirm existence. */
export class TenantNotFound extends Schema.TaggedError<TenantNotFound>()(
  "TenantNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Tenant not found."
}

export class TenantUserNotFound extends Schema.TaggedError<TenantUserNotFound>()(
  "TenantUserNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Tenant user not found."
}

export class TenantExternalIdTaken extends Schema.TaggedError<TenantExternalIdTaken>()(
  "TenantExternalIdTaken",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "The external ID already exists in this scope."
}

/** Tenant-scoped credentials read their own Tenant but never write Tenants. */
export class TenantWriteForbidden extends Schema.TaggedError<TenantWriteForbidden>()(
  "TenantWriteForbidden",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Tenant writes require organization scope."
}
