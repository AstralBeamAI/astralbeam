import { APIError, getOAuthState } from "better-auth/api"
import "@tanstack/react-start/server-only"

type RecordValue = Record<string, unknown>

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

export function recordValue(value: unknown): RecordValue | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as RecordValue
}

export function assertLegalAcceptance(value: unknown): void {
  if (value === true) return
  throw new APIError("BAD_REQUEST", LEGAL_ACCEPTANCE_ERROR)
}

export async function acceptedAtForUserCreation(
  context: UserCreationContext | null,
  readOAuthState: OAuthStateReader = getOAuthState,
): Promise<Date> {
  if (context?.path === "/sign-up/email") {
    assertLegalAcceptance(recordValue(context.body)?.termsAccepted)
    return new Date()
  }

  if (context?.path === "/callback/:id") {
    const state = await readOAuthState()
    if (
      state?.requestSignUp === true &&
      recordValue(state.serverContext)?.termsAccepted === true
    ) {
      return new Date()
    }
  }

  throw new APIError("BAD_REQUEST", LEGAL_ACCEPTANCE_ERROR)
}
