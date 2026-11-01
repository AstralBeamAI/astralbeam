import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { docsPage } from "@e2e/pages/docs-page.ts"

const isSearchModule = (url: string) =>
  url.includes("/-lib/search.ts") || /\/search-[^/]+\.js(?:\?|$)/.test(url)

test("docs search loads lazily and supports keyboard and mobile navigation", async ({ page }) => {
  const docs = docsPage(page)
  const requests: string[] = []
  page.on("request", (request) => requests.push(request.url()))
  await docs.open()
  await docs.openSearch("Meta+k")
  expect(requests.filter(isSearchModule)).toHaveLength(0)
  await docs.search("theme tokens")
  await expect(docs.results.first()).toHaveAttribute("href", "/docs/sdk/theming#theme-tokens")
  expect(requests.filter(isSearchModule)).toHaveLength(1)
  await captureMilestone(page, "docs-search-keyboard-results")
  await page.keyboard.press("ArrowDown")
  await page.keyboard.press("ArrowUp")
  await page.keyboard.press("Enter")
  await expect(page.locator("#theme-tokens")).toBeVisible()
  await docs.openSearch("Control+k")
  await page.keyboard.press("Escape")
  await expect(docs.trigger).toBeFocused()
  await page.setViewportSize({ width: 390, height: 844 })
  await docs.openSearch()
  await docs.search("customCss")
  await expect(docs.results.first()).toHaveAttribute("href", "/docs/sdk/theming#custom-css")
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390)
  await captureMilestone(page, "docs-search-mobile")
  await docs.input.fill("zzzzzzzzzzzzzzzzzzzzzz")
  await expect(docs.dialog.getByText("No results. Try fewer or different words.")).toBeVisible()
  await captureMilestone(page, "docs-search-no-results")
  await docs.input.clear()
  await expect(docs.dialog.getByText("Type to search the documentation.")).toBeVisible()
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

test.describe("touch and mouse", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test("keeps docs search usable on hybrid devices", async ({ page }) => {
    const docs = docsPage(page)
    await docs.open()
    await expect(docs.trigger).toHaveCSS("min-width", "44px")
    await expect(docs.trigger).toHaveCSS("min-height", "44px")
    await docs.trigger.tap()
    await docs.search("theme tokens")
    await captureMilestone(page, "docs-search-touch")
    await docs.results.first().tap()
    await expect(page.locator("#theme-tokens")).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await docs.openSearch()
    await docs.search("customCss")
    await docs.results.first().click()
    await expect(page.locator("#custom-css")).toBeVisible()
  })
})
