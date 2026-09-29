import { render, toPlainText } from "@react-email/render"
import { Effect } from "effect"
import type { ReactElement } from "react"

/** Renders one React Email element to the exact HTML and plain-text payloads providers send. */
export const renderEmailElement = Effect.fn("renderEmailElement")(function* (
  element: ReactElement,
) {
  // A template that cannot render is a bug in this codebase, not a delivery failure.
  const html = yield* Effect.promise(() => render(element))
  return { html, text: toPlainText(html) }
})
