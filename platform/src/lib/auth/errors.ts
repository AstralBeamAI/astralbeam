import { Schema } from "effect"

import { AUTH_EMAIL_DELIVERY_FAILED_MESSAGE } from "./email-delivery.ts"

/** A blocking authentication email could not be handed to the provider, which logged why. */
export class AuthEmailNotDelivered extends Schema.TaggedError<AuthEmailNotDelivered>()(
  "AuthEmailNotDelivered",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = AUTH_EMAIL_DELIVERY_FAILED_MESSAGE
}

/** A verified organization token names a user who is not a member of its organization. */
export class OrganizationMembershipError extends Schema.TaggedError<OrganizationMembershipError>()(
  "OrganizationMembershipError",
  {},
) {}

// The dashboard token endpoint answers with each message as its JSON `error`.

export class DashboardTokenRateLimited extends Schema.TaggedError<DashboardTokenRateLimited>()(
  "DashboardTokenRateLimited",
  {},
  { httpApiStatus: 429 },
) {
  override readonly message = "Too many token requests. Please try again in a minute."
}

export class TenantAccessDenied extends Schema.TaggedError<TenantAccessDenied>()(
  "TenantAccessDenied",
  {},
  { httpApiStatus: 403 },
) {
  override readonly message = "Tenant access is not permitted"
}

export class EmbeddedAssistantUnavailable extends Schema.TaggedError<EmbeddedAssistantUnavailable>()(
  "EmbeddedAssistantUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = "Embedded assistant is unavailable"
}

const ORGANIZATION_API_KEY_REQUIRED_MESSAGE =
  "Create an enabled, unexpired API key for this Organization."

/** Every key the organization has is disabled or expired. */
export class OrganizationApiKeyUnavailable extends Schema.TaggedError<OrganizationApiKeyUnavailable>()(
  "OrganizationApiKeyUnavailable",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = ORGANIZATION_API_KEY_REQUIRED_MESSAGE
}

/** The organization has no key at all, which the directory answers with a create prompt. */
export class OrganizationApiKeysMissing extends Schema.TaggedError<OrganizationApiKeysMissing>()(
  "OrganizationApiKeysMissing",
  {},
  { httpApiStatus: 503 },
) {
  override readonly message = ORGANIZATION_API_KEY_REQUIRED_MESSAGE
}
