// Added with: deno task ui add sidebar
// Local changes: Read the breakpoint through useSyncExternalStore instead of setting state in an effect.

import * as React from "react"

const MOBILE_BREAKPOINT = 768

function subscribeToMobileBreakpoint(onChange: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribeToMobileBreakpoint,
    () => window.innerWidth < MOBILE_BREAKPOINT,
    () => false,
  )
}
