import { readdirSync } from "node:fs"
import { describe, expect, test } from "vitest"

import { isReservedOrganizationSlug, RESERVED_ORGANIZATION_SLUGS } from "./organization-slug.ts"

const routesDirectory = new URL("../../routes/", import.meta.url)

/** The organization slug parameter itself, which every other top-level segment must not shadow. */
const ORGANIZATION_SLUG_SEGMENT = "$orgSlug"

/**
 * Collects the URL segments a request can reach at the top level. Pathless layouts (`_` prefix)
 * and route groups (parentheses) contribute their children's segments rather than their own.
 */
function readTopLevelRouteSegments(directory: URL): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = entry.name
    if (name.startsWith("-") || name.startsWith("__")) return []
    if (entry.isDirectory()) {
      if (name.startsWith("_") || (name.startsWith("(") && name.endsWith(")"))) {
        return readTopLevelRouteSegments(new URL(`${name}/`, directory))
      }
      return [name]
    }
    const base = name.replace(/\.(ts|tsx)$/u, "")
    return base === "index" || base === "route" ? [] : [base]
  })
}

describe("reserved organization slugs", () => {
  test("covers every top-level route segment", () => {
    const segments = readTopLevelRouteSegments(routesDirectory)
      .filter((segment) => segment !== ORGANIZATION_SLUG_SEGMENT)

    expect(segments.length).toBeGreaterThan(0)
    expect(segments.filter((segment) => !isReservedOrganizationSlug(segment))).toEqual([])
  })

  test("rejects reserved slugs case-insensitively and allows ordinary ones", () => {
    expect(isReservedOrganizationSlug("Docs")).toBe(true)
    expect(isReservedOrganizationSlug("acme")).toBe(false)
    expect(RESERVED_ORGANIZATION_SLUGS).toContain("settings")
  })
})
