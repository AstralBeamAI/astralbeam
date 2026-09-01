# Authentication email delivery and partial completion

Every authentication flow in this app is two writes with a network call between them: Better Auth commits a row, then asks an external provider to deliver a link. The provider is the part that fails, and it fails after the row exists. These notes record what each flow leaves behind when delivery fails, how a user recovers, and which trade-offs were accepted deliberately.

## The delivery boundary

- `deliverBlockingAuthEmail` in `email-delivery.server.ts` wraps every send whose caller is waiting on the result, and `assertAuthEmailDelivered` rethrows the recorded failure from the `after` hook in `auth.server.ts`.
- The indirection is required because Better Auth routes most sends through `runInBackgroundOrAwait`, which awaits the callback but logs and swallows its rejection, so a throw inside `sendVerificationEmail` cannot reach the client on its own.
- `advanced.backgroundTasks` must stay unset. A handler defers the send past the response, which is what let a failed send complete behind a "check your inbox" screen.
- The response is `503` with the `EMAIL_DELIVERY_FAILED` code from `email-delivery.ts`; `ErrorToaster` maps that code to the only backend-sourced sentence it will render. The provider's own reason never leaves the server.
- `deliverAuthEmail` in `src/emails/index.ts` is the single place that logs a send outcome. Both outcomes carry a partially masked recipient from `maskEmailAddressForLog`; the rendered email and the token URL are never logged.
- A password-change notice is the one exception: it is informational, its recipient is not waiting on it, and it stays deferred through `runAfterResponse` so an email outage cannot fail a password change that already succeeded.

## What each flow leaves behind

- `/sign-up/email`, new address, delivery fails: the `user` and `credential` `account` rows exist and are unverified. The response now reports the failure instead of routing to the verification screen. The rows are deliberately not rolled back, because signing up again is idempotent and recovers the account.
- `/sign-up/email`, address already registered: Better Auth returns its synthetic-user response so the reply cannot confirm the address exists, and it sends nothing by default. `onExistingUserSignUp` fills that gap — an unverified account gets its verification link resent, a verified account gets the `account-exists` notice pointing at sign-in and password reset. Without this, a duplicate sign-up ends on a verification screen that no email will ever arrive for.
- `/send-verification-email`: Better Auth rethrows the callback's error itself, so this path surfaces the same `APIError` without the `after` hook. It answers an unknown or already-verified address with a generic success and no send, by design.
- `/request-password-reset`, address known, delivery fails: the reset token row exists and stays valid until it expires. The response reports the failure, and a retry mints a new token.
- `/organization/invite-member`, delivery fails: the `invitation` row exists and is pending. `InviteMemberDialog` refetches the invitation list on this error so the pending row appears with its resend control, which is the recovery path; without the refetch the invitation is invisible until the next fetch.
- `/sign-in/email` with an unverified account: `sendOnSignIn` is false, so no email is sent and `EMAIL_NOT_VERIFIED` routes to the verification screen, where the resend button is the way to get a fresh link.

## Accepted trade-offs

- Rate limits: `/sign-up/email`, `/request-password-reset`, `/send-verification-email`, and `/organization/invite-member` each send one email to a caller-supplied address, so each has its own `customRules` bucket on top of the Turnstile gate. Adding a send to any other unauthenticated path requires the same treatment.
- Sign-up stays indistinguishable during an outage because both branches send exactly one email: a new address and a registered one fail identically. Keep it that way — a branch that sends nothing would turn an outage into an address oracle.
- `/request-password-reset` is not symmetric: an unknown address attempts no send and cannot fail. During a provider outage, a surfaced failure therefore implies the address is registered. This is accepted because telling a real user their reset email failed beats a silent lie, the window is an operator-visible outage, and Better Auth's own `/send-verification-email` makes the identical trade.
- Signing up again over an unverified account keeps the original password, because Better Auth's enumeration-protecting path never checks the submitted one. A user who retries with a different password must use password reset. This is upstream behaviour and cannot be fixed without weakening that protection.
