import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { docsPage } from "@e2e/pages/docs-page.ts"

test.use({ storageState: { cookies: [], origins: [] } })

const isSearchModule = (url: string) =>
  url.includes("/-lib/search.ts") || /\/search-[^/]+\.js(?:\?|$)/.test(url)

test("docs search preloads before opening and stays local", async ({ page }) => {
  const docs = docsPage(page)
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await docs.open()
  await expect.poll(() => requests.filter(isSearchModule).length).toBe(1)
  await docs.openSearch()
  await docs.search("theme tokens")
  await expect(docs.results.first()).toHaveAttribute("href", "/docs/sdk/theming#theme-tokens")
  expect(requests.filter(isSearchModule)).toHaveLength(1)
  await captureMilestone(page, "docs-search-results")
  await page.keyboard.press("Enter")
  await expect(page.locator("#theme-tokens")).toBeVisible()
  expect(requests.filter((url) => url.includes("/api/v1/docs/search"))).toHaveLength(0)
})

test("docs search can retry a failed documentation download", async ({ page }) => {
  const docs = docsPage(page)
  await page.route("**/*theming*", (route) => route.abort("failed"))
  await docs.open()
  await docs.openSearch()
  await docs.input.fill("theme tokens")
  await expect(docs.dialog.getByText("Search could not load.")).toBeVisible()
  await captureMilestone(page, "docs-search-download-failure")
  await page.unroute("**/*theming*")
  await docs.dialog.getByRole("button", { name: "Try again" }).click()
  await expect(docs.results.first()).toHaveAttribute("href", "/docs/sdk/theming#theme-tokens")
})

test("docs search previews the matching passage below the title", async ({ page }) => {
  const docs = docsPage(page)
  await docs.open()
  await docs.openSearch()
  await docs.search("font-sans")
  await expect(docs.results.first()).toHaveAttribute("href", "/docs/sdk/theming#theme-tokens")
  const preview = docs.previews.first()
  await captureMilestone(page, "docs-search-matching-passage")
  await expect(preview).toContainText("--font-sans")
  expect((await preview.innerText()).length).toBeLessThanOrEqual(182)
})

for (const [label, query, path] of [
  ["identifier", "sendMessage", "sdk/headless"],
  ["identifier example", "sendMessage example", "sdk/headless"],
  ["qualified identifier", "chat.sendMessage", "sdk/headless"],
  ["camelCase theme", "darkMode", "sdk/theming"],
  ["camelCase hosting", "selfHosting", "self-hosting/"],
  [
    "dark-setting question",
    "How do I make the chat follow the operating system dark setting?",
    "sdk/theming",
  ],
  [
    "tool question",
    "How do I give the assistant a tool implemented by my application?",
    "sdk/tools-and-widgets",
  ],
] as const) {
  test(`docs search finds the owning guide: ${label}`, async ({ page }) => {
    const docs = docsPage(page)
    await docs.open()
    await docs.openSearch()
    await docs.search(query)
    const url = path.endsWith("/") ? `^/docs/${path}` : `^/docs/${path}(?:#|$)`
    await expect(docs.results.first()).toHaveAttribute("href", new RegExp(url))
    if (path === "sdk/headless") {
      await expect(docs.results.nth(1)).toHaveAttribute(
        "href",
        "/docs/sdk/configuration#shared-session",
      )
      await expect(docs.previews.nth(0)).toContainText("sendMessage")
      await expect(docs.previews.nth(1)).toContainText("sendMessage")
    }
    await captureMilestone(page, `docs-search-${label.replaceAll(" ", "-")}`)
  })
}
