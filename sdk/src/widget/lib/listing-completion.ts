import { useEffect } from "react"

export type ListingCompletion = ((error: Error | null) => void) | undefined

export function useListingCompletion(
  complete: ListingCompletion,
  pending: boolean,
  error: Error | null,
) {
  useEffect(() => {
    if (!pending) complete?.(error)
  }, [complete, pending, error])
}
