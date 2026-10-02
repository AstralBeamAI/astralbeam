// Added with: deno task ui add @better-auth-ui/auth
// Local changes: Use the contextual Base UI Toast manager, suppress field-handled errors, sanitize backend details, surface email, invalid-link, and API-key protection codes, and repair strict cache-handler cleanup.

import {
  authMutationKeys,
  authQueryKeys,
  getAuthErrorPresentation,
  isPasswordCompromisedError,
  isSessionNotFreshError,
} from "@better-auth-ui/core"
import { matchMutation, matchQuery, useQueryClient } from "@tanstack/react-query"
import { Predicate } from "effect"
import { useEffect } from "react"
import { useToastManager } from "@/components/ui/toast"
import {
  AUTH_EMAIL_DELIVERY_FAILED_MESSAGE,
  isAuthEmailDeliveryError,
} from "@/lib/auth/email-delivery"

function authErrorCode(error: unknown): string | undefined {
  if (!Predicate.hasProperty(error, "error") || !Predicate.hasProperty(error.error, "code")) {
    return undefined
  }
  return Predicate.isString(error.error.code) ? error.error.code : undefined
}

/** Better Auth's check-slug and create endpoints reject a taken slug with these codes. */
export function isOrganizationSlugTakenError(error: unknown): boolean {
  const code = authErrorCode(error)
  return code === "ORGANIZATION_SLUG_ALREADY_TAKEN" || code === "ORGANIZATION_ALREADY_EXISTS"
}

function safeAuthError(error: unknown): string {
  if (isAuthEmailDeliveryError(error)) return AUTH_EMAIL_DELIVERY_FAILED_MESSAGE
  if (authErrorCode(error) === "INVALID_TOKEN") {
    return "This link is invalid or has expired. Please request a new link."
  }
  if (authErrorCode(error) === "LAST_API_KEY") {
    return "The last API key cannot be deleted. Create another key first."
  }
  if (authErrorCode(error) === "DOGFOOD_API_KEY_IN_USE") {
    return "This API key is used by the embedded assistant and cannot be deleted."
  }
  const status =
    Predicate.hasProperty(error, "status") && Predicate.isNumber(error.status)
      ? error.status
      : undefined
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

    mutationCache.config.onError = (error, variables, onMutateResult, mutation, context) => {
      previousMutationOnError?.(error, variables, onMutateResult, mutation, context)

      if (!matchMutation({ mutationKey: authMutationKeys.all }, mutation)) {
        return
      }
      if (getAuthErrorPresentation(mutation.meta) !== "toast") return
      if (isSessionNotFreshError(error)) return
      // Every form that sets a new password renders this one against the
      // password field, so a toast would just repeat it.
      if (isPasswordCompromisedError(error)) return
      // The create organization dialog renders a taken slug against its slug field.
      if (isOrganizationSlugTakenError(error)) return

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
