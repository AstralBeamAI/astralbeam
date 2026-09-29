import { APIError, getOAuthState } from "better-auth/api"
import { DateTime, Effect, Predicate } from "effect"

interface UserCreationContext {
  body?: unknown
  path?: string
}

interface LegalOAuthState {
  requestSignUp?: boolean
  serverContext?: Record<string, unknown>
  [key: string]: unknown
}

type OAuthStateReader = () => Promise<LegalOAuthState | null>

const LEGAL_ACCEPTANCE_ERROR = {
  code: "legal_acceptance_required",
  message: "Terms and privacy policy acceptance is required",
} as const

/** The object a Better Auth hook received, or `undefined` for any other value. */
export function recordValue(value: unknown): Record<PropertyKey, unknown> | undefined {
  return Predicate.isObject(value) ? value : undefined
}

export function assertLegalAcceptance(value: unknown): void {
  if (value === true) return
  throw new APIError("BAD_REQUEST", LEGAL_ACCEPTANCE_ERROR)
}

/** The server's own acceptance time for a user whose signup asserted it, never a client's. */
export const acceptedAtForUserCreation = Effect.fn("acceptedAtForUserCreation")(function* (
  context: UserCreationContext | null,
  readOAuthState: OAuthStateReader = getOAuthState,
) {
  const accepted =
    context?.path === "/sign-up/email"
      ? recordValue(context.body)?.termsAccepted === true
      : context?.path === "/callback/:id" &&
        (yield* Effect.map(
          Effect.promise(readOAuthState),
          (state) =>
            state?.requestSignUp === true &&
            recordValue(state.serverContext)?.termsAccepted === true,
        ))
  if (!accepted) return yield* Effect.fail(new APIError("BAD_REQUEST", LEGAL_ACCEPTANCE_ERROR))
  return DateTime.toDateUtc(yield* DateTime.now)
})
