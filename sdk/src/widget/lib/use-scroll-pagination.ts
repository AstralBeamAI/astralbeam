import type { UseInfiniteQueryResult } from "@tanstack/react-query"
import { type RefObject, useEffect } from "react"

export function useScrollPagination({
  list,
  enabled,
  query,
}: {
  list: RefObject<HTMLDivElement | null>
  enabled: boolean
  query: Pick<
    UseInfiniteQueryResult,
    "hasNextPage" | "isFetching" | "isError" | "fetchNextPage" | "data"
  >
}) {
  const { hasNextPage, isFetching, isError, fetchNextPage, data } = query
  useEffect(() => {
    const element = list.current
    if (!enabled || !element || !hasNextPage || isFetching || isError) return
    const loadNextPage = () => {
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 48)
        void fetchNextPage({ cancelRefetch: false })
    }
    // Short pages must load the next page even when there is no overflow to scroll yet.
    loadNextPage()
    element.addEventListener("scroll", loadNextPage)
    return () => element.removeEventListener("scroll", loadNextPage)
  }, [list, enabled, hasNextPage, isFetching, isError, fetchNextPage, data])
}
