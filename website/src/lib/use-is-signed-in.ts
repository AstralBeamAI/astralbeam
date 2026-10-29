import { useEffect, useState } from "react"

// Keep the name in step with `SIGNED_IN_COOKIE` in platform/src/lib/auth/auth.server.ts.
const signedInCookie = "astralbeam_signed_in"

/**
 * Trusts the platform's readable sign-in hint after hydration, then confirms the session after
 * page load. Public HTML stays independent of the visitor.
 */
export function useIsSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    if (!document.cookie.split("; ").some((cookie) => cookie === `${signedInCookie}=1`)) return
    setSignedIn(true)
    const controller = new AbortController()
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/get-session", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok || controller.signal.aborted) return
        const session = (await response.json()) as { user?: { id?: string } } | null
        if (session?.user?.id) return
        // An expired session leaves the hint behind, so drop it and show the sign-up link again.
        document.cookie = `${signedInCookie}=; Max-Age=0; Path=/`
        setSignedIn(false)
      } catch {
        // Keep the hint's state when the platform is unavailable or the request is cancelled.
      }
    }
    const onLoad = () => void checkSession()
    if (document.readyState === "complete") onLoad()
    else window.addEventListener("load", onLoad, { once: true })
    return () => {
      window.removeEventListener("load", onLoad)
      controller.abort()
    }
  }, [])

  return signedIn
}
