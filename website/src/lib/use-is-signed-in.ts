import { useEffect, useState } from "react"

/** Checks the session after page load, keeping public HTML independent of the visitor. */
export function useIsSignedIn(): boolean {
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/get-session", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) return
        const session = (await response.json()) as { user?: { id?: string } } | null
        if (!controller.signal.aborted) setSignedIn(Boolean(session?.user?.id))
      } catch {
        // Keep sign-in links usable when the platform is unavailable or the request is cancelled.
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
