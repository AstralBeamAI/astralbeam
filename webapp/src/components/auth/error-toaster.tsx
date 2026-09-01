// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use the contextual Base UI Toast manager, suppress field-handled errors, guard unknown rejection values, sanitize backend details, surface the email delivery failure code, and repair strict cache-handler cleanup.

import {
  authMutationKeys,
  authQueryKeys,
  getAuthErrorPresentation,
  isPasswordCompromisedError,
  isSessionNotFreshError,
} from "@better-auth-ui/core"
import { matchMutation, matchQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"
import { useToastManager } from "@/components/ui/toast"
import {
  AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
  isAuthEmailDeliveryError,
} from "@/lib/auth/email-delivery"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function authErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.error)) return undefined
  return typeof error.error.code === "string" ? error.error.code : undefined
}

function safeAuthError(error: unknown): string {
  // The only backend detail allowed through: the server sets this code with no provider reason
  // attached, and a caller waiting on an email needs to know delivery is what failed.
  if (isAuthEmailDeliveryError(error)) return AUTH_EMAIL_DELIVERY_FAILED_MESSAGE
  const status = isRecord(error) && typeof error.status === "number" ? error.status : undefined
  if (status === 429) {
    return "Too many attempts. Please wait a moment and try again."
  }
  if (status === 401 || status === 403) {
    return "You do not have permission to complete that request."
  }
  if (error instanceof TypeError) {
    return "The authentication service is unavailable. Please try again."
  }
  return "We could not complete that request. Please try again."
}

export function ErrorToaster() {
  const queryClient = useQueryClient()
  const { add: addToast } = useToastManager()

  useEffect(() => {
    const queryCache = queryClient.getQueryCache()
    const previousQueryOnError = queryCache.config.onError

    queryCache.config.onError = (error, query) => {
      previousQueryOnError?.(error, query)

      if (!matchQuery({ queryKey: authQueryKeys.all }, query)) return
      if (getAuthErrorPresentation(query.meta) !== "toast") return
      if (isSessionNotFreshError(error)) return

      if (authErrorCode(error) === "EMAIL_NOT_VERIFIED") return
      addToast({ title: safeAuthError(error), type: "error" })
    }

    const mutationCache = queryClient.getMutationCache()
    const previousMutationOnError = mutationCache.config.onError

    mutationCache.config.onError = (
      error,
      variables,
      onMutateResult,
      mutation,
      context,
    ) => {
      previousMutationOnError?.(
        error,
        variables,
        onMutateResult,
        mutation,
        context,
      )

      if (!matchMutation({ mutationKey: authMutationKeys.all }, mutation)) {
        return
      }
      if (getAuthErrorPresentation(mutation.meta) !== "toast") return
      if (isSessionNotFreshError(error)) return
      // Every form that sets a new password renders this one against the
      // password field, so a toast would just repeat it.
      if (isPasswordCompromisedError(error)) return

      if (authErrorCode(error) === "EMAIL_NOT_VERIFIED") return
      addToast({ title: safeAuthError(error), type: "error" })
    }

    return () => {
      if (previousQueryOnError) queryCache.config.onError = previousQueryOnError
      else delete queryCache.config.onError
      if (previousMutationOnError) mutationCache.config.onError = previousMutationOnError
      else delete mutationCache.config.onError
    }
  }, [addToast, queryClient])

  return null
}
