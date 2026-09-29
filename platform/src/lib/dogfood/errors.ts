import { Schema } from "effect"

const OWNER_ONBOARDING_MESSAGES = {
  configurationIncomplete: "Complete the application configuration before inviting the owner",
  emailNotSent: "The owner onboarding email could not be sent. Check email settings and try again.",
  organizationNotCreated: "The dogfood organization could not be created",
  organizationNotOwned: "That organization is not owned by the selected account",
  organizationNotOwnedByPending: "That organization is not owned by the pending account",
  organizationUnavailable: "The provisioned organization is unavailable",
  ownerEmailInUse: "Use an unused email address to invite the owner.",
  ownerUnverified: "That account is not verified. Choose a different owner email.",
  pendingInvalid: "Pending onboarding is invalid",
  replacementEmailInUse: "Use an unused email address to replace the pending owner.",
  slugInUse: "That organization slug is already in use.",
  undecryptable: "Onboarding could not be decrypted. Restore the database encryption key.",
} as const

/** Each reason has one fixed message, written for the operator inviting the owner. */
export class OwnerOnboardingFailed extends Schema.TaggedError<OwnerOnboardingFailed>()(
  "OwnerOnboardingFailed",
  { reason: Schema.Literals(Object.keys(OWNER_ONBOARDING_MESSAGES) as OwnerOnboardingReason[]) },
  { httpApiStatus: 409 },
) {
  override get message() {
    return OWNER_ONBOARDING_MESSAGES[this.reason]
  }
}

type OwnerOnboardingReason = keyof typeof OWNER_ONBOARDING_MESSAGES

/** Another operator request holds the provisioning lock. */
export class ConfigurationBusy extends Schema.TaggedError<ConfigurationBusy>()(
  "ConfigurationBusy",
  {},
  { httpApiStatus: 409 },
) {
  override readonly message = "Configuration is busy. Try again shortly."
}
