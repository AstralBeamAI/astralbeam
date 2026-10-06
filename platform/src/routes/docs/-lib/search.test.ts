import { expect, test } from "vitest"

import { readDocsPage, searchDocs } from "./search"

test("search ranks the owning section and covers the API guides", async () => {
  const { results } = await searchDocs("dark mode colors")
  expect(results[0]).toMatchObject({ path: "sdk/theming", url: "/docs/sdk/theming" })
  const api = await searchDocs("pagination cursor")
  expect(api.results.map((result) => result.path)).toContain("api/pagination-and-errors")
})

test("reading an unknown page lists the readable paths", async () => {
  expect((await readDocsPage("sdk/theming")).markdown).toMatch(/^# Theming/)
  expect((await readDocsPage("sdk/missing")).paths).toContain("cli/commands")
})
