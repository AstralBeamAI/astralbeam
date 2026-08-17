// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/auth-provider`
// Local edits: Replaces generated Sonner calls with Shadcn Base UI toast, omits unused email and One Tap exceptions, and decodes errors without unsafe assertions.

import { authMutationKeys, authQueryKeys } from "@better-auth-ui/core"
import { matchMutation, matchQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect } from "react"

import { toast } from "@/components/toast"

function readAuthErrorMessage(error: Error) {
  let message = error.message

  if ("error" in error && error.error && typeof error.error === "object") {
    if ("message" in error.error && typeof error.error.message === "string") {
      message = error.error.message
    }
  }

  return message
}

export function ErrorToaster() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const queryCache = queryClient.getQueryCache()
    const previousQueryOnError = queryCache.config.onError

    queryCache.config.onError = (error, query) => {
      previousQueryOnError?.(error, query)
      if (!matchQuery({ queryKey: authQueryKeys.all }, query)) return

      toast.add({ title: readAuthErrorMessage(error), type: "error" })
    }

    const mutationCache = queryClient.getMutationCache()
    const previousMutationOnError = mutationCache.config.onError

    mutationCache.config.onError = (error, variables, onMutateResult, mutation, context) => {
      previousMutationOnError?.(error, variables, onMutateResult, mutation, context)
      if (!matchMutation({ mutationKey: authMutationKeys.all }, mutation)) return

      toast.add({ title: readAuthErrorMessage(error), type: "error" })
    }

    return () => {
      if (previousQueryOnError) queryCache.config.onError = previousQueryOnError
      else delete queryCache.config.onError

      if (previousMutationOnError) mutationCache.config.onError = previousMutationOnError
      else delete mutationCache.config.onError
    }
  }, [queryClient])

  return null
}
