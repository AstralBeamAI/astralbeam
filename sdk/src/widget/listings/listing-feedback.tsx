import { isAstralBeamApiError } from "../../api/api.ts"
import { Button } from "../components/ui/button.tsx"
import { Skeleton } from "../components/ui/skeleton.tsx"
import { Alert, AlertDescription, AlertTitle } from "../components/ui/alert.tsx"

export function ListingLoading() {
  return (
    <div role="status" aria-label="Loading directory" className="space-y-3 p-4">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  )
}

export function ListingError({ error, retry }: { error: Error; retry: () => void }) {
  const apiError = isAstralBeamApiError(error) ? error : undefined
  const status = apiError?.status
  const titles: Record<number, string> = {
    401: "Authentication required",
    403: "Access denied",
    404: "Resource not found",
    429: "Too many requests",
  }
  const retryAfter = apiError?.headers.get("retry-after")
  return (
    <Alert variant="destructive">
      <AlertTitle>{titles[status ?? 0] ?? "Unable to load directory"}</AlertTitle>
      <AlertDescription>
        {status === 429 ? `Please retry after ${retryAfter ?? "a few"} seconds.` : error.message}
      </AlertDescription>
      <Button variant="outline" size="sm" onClick={retry}>
        Retry
      </Button>
    </Alert>
  )
}
