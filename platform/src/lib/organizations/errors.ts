import { Schema } from "effect"

export class SignInRequired extends Schema.TaggedError<SignInRequired>()(
  "SignInRequired",
  {},
  { httpApiStatus: 401 },
) {
  override readonly message = "Authentication required"
}

// A missing organization and a non-member read alike, so the reply cannot confirm existence.
export class OrganizationNotFound extends Schema.TaggedError<OrganizationNotFound>()(
  "OrganizationNotFound",
  {},
  { httpApiStatus: 404 },
) {
  override readonly message = "Organization is unavailable"
}

export class OrganizationAccessDenied extends Schema.TaggedError<OrganizationAccessDenied>()(
  "OrganizationAccessDenied",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Organization is unavailable"
}

/** The stored key does not decrypt with the active keyring, or belongs to another organization. */
export class OrganizationOpenaiApiKeyUnreadable extends Schema.TaggedError<OrganizationOpenaiApiKeyUnreadable>()(
  "OrganizationOpenaiApiKeyUnreadable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "The organization's OpenAI API key could not be read"
}

export class OrganizationSlugTaken extends Schema.TaggedError<OrganizationSlugTaken>()(
  "OrganizationSlugTaken",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "An organization with this slug already exists"
}

/** The slug in the URL moved to another organization since the page rendered. */
export class OrganizationChanged extends Schema.TaggedError<OrganizationChanged>()(
  "OrganizationChanged",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "This organization changed. Reload and try again."
}

export class DogfoodOrganizationProtected extends Schema.TaggedError<DogfoodOrganizationProtected>()(
  "DogfoodOrganizationProtected",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "This deployment's own organization cannot be deleted"
}

export class OrganizationDeletionUnavailable extends Schema.TaggedError<OrganizationDeletionUnavailable>()(
  "OrganizationDeletionUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Background jobs are unavailable. Try again shortly."
}
