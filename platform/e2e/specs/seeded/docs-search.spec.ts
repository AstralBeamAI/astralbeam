import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { docsPage } from "@e2e/pages/docs-page.ts"

const isSearchModule = (url: string) =>
  url.includes("/-lib/search.ts") || /\/search-[^/]+\.js(?:\?|$)/.test(url)

test("docs search opens from the navbar, loads lazily, and stays local", async ({ page }) => {
  const docs = docsPage(page)
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await docs.open()
  await docs.openSearch()
  expect(requests.filter(isSearchModule)).toHaveLength(0)
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
