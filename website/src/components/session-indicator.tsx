import { useLocation } from "@tanstack/react-router"
import { useLayoutEffect } from "react"

const cookieName = "astralbeam_signed_in"
const initializeSessionIndicator = `{const update = () => {document.getElementById("session-indicator").sheet.cssRules[0].selectorText = document.cookie.split(";").some(cookie => cookie.trim() === "${cookieName}=1") ? '[data-session="signed-out"]' : '[data-session="signed-in"]'};update();window.addEventListener("pageshow", update)}`
const sessionIndicatorStyles = `[data-session="signed-in"] { display: none !important; }`

/** Selects public navigation before paint without personalizing cached HTML. */
export function SessionIndicator() {
  const pathname = useLocation({ select: ({ pathname }) => pathname })
  useLayoutEffect(() => {
    const signedIn = document.cookie
      .split(";")
      .some((cookie) => cookie.trim() === `${cookieName}=1`)
    const stylesheet = (document.getElementById("session-indicator") as HTMLStyleElement).sheet!
    const rule = stylesheet.cssRules[0] as CSSStyleRule
    // CSSOM changes leave React's markup intact, so hydration needs no suppression.
    const selector = signedIn ? '[data-session="signed-out"]' : '[data-session="signed-in"]'
    if (rule.selectorText !== selector) rule.selectorText = selector
  }, [pathname])

  return (
    <>
      <style id="session-indicator">{sessionIndicatorStyles}</style>
      <script>{initializeSessionIndicator}</script>
    </>
  )
}
