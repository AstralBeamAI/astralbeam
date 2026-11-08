import { Schema } from "effect"

export class SignInRequired extends Schema.TaggedError<
  SignInRequired,
  { readonly brand: unique symbol }
>()("SignInRequired", {}, { httpApiStatus: 401 }) {
  override readonly message = "Authentication required"
}

// A missing organization and a non-member read alike, so the reply cannot confirm existence.
export class OrganizationNotFound extends Schema.TaggedError<
  OrganizationNotFound,
  { readonly brand: unique symbol }
>()("OrganizationNotFound", {}, { httpApiStatus: 404 }) {
  override readonly message = "Organization is unavailable"
}

export class OrganizationAccessDenied extends Schema.TaggedError<
  OrganizationAccessDenied,
  { readonly brand: unique symbol }
>()("OrganizationAccessDenied", {}, { httpApiStatus: 403 }) {
  override readonly message = "Organization is unavailable"
}

export class OrganizationSlugTaken extends Schema.TaggedError<
  OrganizationSlugTaken,
  { readonly brand: unique symbol }
>()("OrganizationSlugTaken", {}, { httpApiStatus: 409 }) {
  override readonly message = "An organization with this slug already exists"
}

/** The slug in the URL moved to another organization since the page rendered. */
export class OrganizationChanged extends Schema.TaggedError<
  OrganizationChanged,
  { readonly brand: unique symbol }
>()("OrganizationChanged", {}, { httpApiStatus: 409 }) {
  override readonly message = "This organization changed. Reload and try again."
}

export class DogfoodOrganizationProtected extends Schema.TaggedError<
  DogfoodOrganizationProtected,
  { readonly brand: unique symbol }
>()("DogfoodOrganizationProtected", {}, { httpApiStatus: 403 }) {
  override readonly message = "This deployment's own organization cannot be deleted"
}

export class OrganizationDeletionUnavailable extends Schema.TaggedError<
  OrganizationDeletionUnavailable,
  { readonly brand: unique symbol }
>()("OrganizationDeletionUnavailable", {}, { httpApiStatus: 503 }) {
  override readonly message = "Background jobs are unavailable. Try again shortly."
}
