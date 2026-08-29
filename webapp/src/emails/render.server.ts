import { render, toPlainText } from "@react-email/render"
import type { ReactElement } from "react"

interface RenderedEmailContent {
  html: string
  text: string
}

/** Render one React Email element to the exact HTML and plain-text payloads sent by providers. */
export async function renderEmailElement(element: ReactElement): Promise<RenderedEmailContent> {
  const html = await render(element)
  return { html, text: renderEmailPlainText(html) }
}

/** Derive the plain-text alternative from already rendered email HTML. */
export function renderEmailPlainText(html: string): string {
  return toPlainText(html)
}
