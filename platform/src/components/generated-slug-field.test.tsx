import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { GeneratedSlugField } from "./generated-slug-field.tsx"

describe("GeneratedSlugField", () => {
  it("follows the name without a suffix and starts blank without an error", () => {
    const render = (sourceValue: string) =>
      renderToString(createElement(GeneratedSlugField, { id: "slug", label: "Slug", sourceValue }))
    expect(render("Acme Logistics")).toContain('value="acme-logistics"')
    const blank = render("")
    expect(blank).toContain('value=""')
    expect(blank).not.toContain("Identifier is required")
  })
})
