import { createElement } from "react"
import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { GeneratedSlugField } from "./generated-slug-field.tsx"

describe("GeneratedSlugField", () => {
  it("defers random suffix generation until after hydration", () => {
    const createSuffixBytes = vi.fn(() => new Uint8Array([0, 1, 2, 3, 4]))
    const field = createElement(GeneratedSlugField, {
      id: "agent-identifier",
      label: "Identifier",
      sourceValue: "Production agent",
      fallback: "agent",
      createSuffixBytes,
    })

    expect(renderToString(field)).toBe(renderToString(field))
    expect(createSuffixBytes).not.toHaveBeenCalled()
  })
})
