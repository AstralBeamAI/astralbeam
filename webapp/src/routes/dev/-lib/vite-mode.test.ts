import { devtools } from "@tanstack/devtools-vite"
import { describe, expect, test } from "vitest"

import { DEVELOPMENT_DEVTOOLS_OPTIONS, enableDevelopmentUtilities } from "./vite-mode.ts"

const SOURCE_INJECTION_PLUGIN_NAME = "@tanstack/devtools:inject-source"
const JSX_SOURCE = "const Example = () => <main>Email</main>"

function sourceInjectionHandler(): (code: string, id: string) => unknown {
  const plugin = devtools(DEVELOPMENT_DEVTOOLS_OPTIONS).find(
    ({ name }) => name === SOURCE_INJECTION_PLUGIN_NAME,
  )
  const transform = plugin?.transform as
    | { handler?: (code: string, id: string) => unknown }
    | undefined
  if (typeof transform?.handler !== "function") {
    throw new Error("TanStack Devtools source-injection transform is unavailable")
  }
  return transform.handler
}

describe("development utility build boundary", () => {
  test("enables utilities only on the live development server", () => {
    expect(enableDevelopmentUtilities("serve", false)).toBe(true)
    expect(enableDevelopmentUtilities("serve", undefined)).toBe(true)
    expect(enableDevelopmentUtilities("serve", true)).toBe(false)
    expect(enableDevelopmentUtilities("build", false)).toBe(false)
    expect(enableDevelopmentUtilities("build", true)).toBe(false)
  })

  test("keeps source-inspection attributes out of production email components only", async () => {
    const transform = sourceInjectionHandler()
    const emailResult = await transform(
      JSX_SOURCE,
      `${process.cwd()}/src/emails/templates/example.tsx`,
    )
    const applicationResult = await transform(
      JSX_SOURCE,
      `${process.cwd()}/src/components/example.tsx`,
    )

    expect(emailResult).toBeUndefined()
    expect((applicationResult as { code: string }).code).toContain("data-tsd-source")
  })
})
