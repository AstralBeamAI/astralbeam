import { ArrowClockwiseIcon } from "@phosphor-icons/react"
import { useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { APP_NAME } from "@/lib/constants"

const ROUTE_ERROR_TOAST_ID = "route-error"

export function RouteErrorBoundary() {
  const router = useRouter()
  const { add: addToast } = useToastManager()
  const [isRetrying, setIsRetrying] = useState(false)

  useEffect(() => {
    addToast({
      id: ROUTE_ERROR_TOAST_ID,
      title: "We couldn't load this page.",
      description: "Try again in a moment.",
      type: "error",
    })
  }, [addToast])

  async function retry() {
    if (isRetrying) return

    setIsRetrying(true)
    try {
      await router.invalidate()
    } catch {
      addToast({
        id: ROUTE_ERROR_TOAST_ID,
        title: "The page still couldn't be loaded.",
        description: "Please wait a moment, then try again.",
        type: "error",
      })
    } finally {
      setIsRetrying(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <section
        aria-labelledby="route-error-title"
        className="w-full max-w-md border bg-card p-6 text-card-foreground shadow-sm"
      >
        <p className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
          {APP_NAME}
        </p>
        <h1
          id="route-error-title"
          className="mt-2 text-xl font-semibold tracking-tight"
        >
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We couldn't load this page. Try again in a moment.
        </p>
        <Button
          type="button"
          className="mt-5"
          disabled={isRetrying}
          onClick={() => void retry()}
        >
          <ArrowClockwiseIcon
            aria-hidden="true"
            className={isRetrying ? "animate-spin" : undefined}
          />
          {isRetrying ? "Retrying…" : "Try again"}
        </Button>
      </section>
    </div>
  )
}
