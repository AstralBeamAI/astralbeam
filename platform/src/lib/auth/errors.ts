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
