import { Effect } from "effect"

import { runAppEffect } from "@/lib/runtime/app-effect.server"
import { Mailer } from "./email.server.ts"
import type {
  AccountExistsEmailData,
  BetterAuthLinkEmailData,
  OrganizationInvitationEmailData,
  PasswordChangedEmailData,
} from "./messages.server.ts"

// Seam: Better Auth callbacks await Promises, so these run Mailer sends on the app runtime until
// the Auth service calls the Mailer directly. A rejection carries only `EmailDeliveryError`.
function runMailerSend(send: (mailer: Mailer["Service"]) => Effect.Effect<void, unknown>) {
  return runAppEffect(Effect.flatMap(Mailer, send))
}

export function sendVerificationEmail(data: BetterAuthLinkEmailData): Promise<void> {
  return runMailerSend((mailer) => mailer.sendVerification(data))
}

export function sendResetPasswordEmail(data: BetterAuthLinkEmailData): Promise<void> {
  return runMailerSend((mailer) => mailer.sendResetPassword(data))
}

export function sendPasswordChangedEmail(data: PasswordChangedEmailData): Promise<void> {
  return runMailerSend((mailer) => mailer.sendPasswordChanged(data))
}

export function sendAccountExistsEmail(data: AccountExistsEmailData): Promise<void> {
  return runMailerSend((mailer) => mailer.sendAccountExists(data))
}

export function sendOrganizationInvitationEmail(
  data: OrganizationInvitationEmailData,
): Promise<void> {
  return runMailerSend((mailer) => mailer.sendOrganizationInvitation(data))
}
