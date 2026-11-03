import { expect, test } from "vitest"

import { readDocsPage, searchDocs } from "./search"

test("search ranks the owning section and covers the API guides", async () => {
  const { results } = await searchDocs("dark mode colors")
  expect(results[0]).toMatchObject({ path: "sdk/theming", url: "/docs/sdk/theming#color-scheme" })
  const api = await searchDocs("pagination cursor")
  expect(api.results.map((result) => result.path)).toContain("api/pagination-and-errors")
  expect(api.results.find((result) => result.path === "api/pagination-and-errors")?.url).toBe(
    "/docs/api#description/pagination",
  )
})

test("code identifiers remain searchable and pages readable by Astro", async () => {
  const code = await searchDocs("customCss")
  expect(code.results[0]).toMatchObject({
    path: "sdk/theming",
    url: "/docs/sdk/theming#custom-css",
  })
  expect(new Set(code.results.map((result) => result.path)).size).toBe(code.results.length)
  expect((await readDocsPage(code.results[0]!.path)).markdown).toContain("## Custom CSS")
  expect(await searchDocs("   ")).toEqual({ results: [] })
})

test("reading an unknown page lists the readable paths", async () => {
  expect((await readDocsPage("sdk/theming")).markdown).toMatch(/^# Theming/)
  expect((await readDocsPage("sdk/missing")).paths).toContain("cli/commands")
})

test("identifier tokenization ranks the owning guide for option questions", async () => {
  for (const [query, path] of [
    ["Where do I set the colorScheme option?", "sdk/theming"],
    ["Where should I put usageLimitIds when minting a token?", "dashboard/usage-limits"],
  ] as const) {
    expect((await searchDocs(query)).results[0]?.path).toBe(path)
  }
})

test("stopwords keep natural-language questions focused on the relevant guide", async () => {
  for (const [query, path] of [
    ["How do I make the chat follow the operating system dark setting?", "sdk/theming"],
    ["How do I give the assistant a tool implemented by my application?", "sdk/tools-and-widgets"],
  ] as const) {
    expect((await searchDocs(query)).results[0]?.path).toBe(path)
  }
})

test("tuned search keeps natural-language answers and misspelled terms discoverable", async () => {
  for (const [query, path, maximumRank] of [
    ["how do I change the chat colors", "sdk/theming", 3],
    ["how do I embed chat in Rails", "sdk/script-tag", 1],
    ["paginaton", "api/pagination-and-errors", 1],
    ["deplyoment", "self-hosting/deploy", 1],
    ["sandbxo", "sdk/sandbox", 1],
    ["maxTotalBytes", "sdk/attachments", 1],
  ] as const) {
    const { results } = await searchDocs(query)
    expect(results.slice(0, maximumRank).map((result) => result.path)).toContain(path)
  }
  expect((await searchDocs("draft recovery")).results[0]?.url).toBe(
    "/docs/sdk/attachments#draft-recovery",
  )
})
