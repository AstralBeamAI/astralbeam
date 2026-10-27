import { expect, test } from "@e2e/fixtures.ts"
import type { Route } from "@playwright/test"

test.use({ storageState: { cookies: [], origins: [] } })

for (const { path, width, height } of [
  { path: "/docs/cli/getting-started", width: 1350, height: 940 },
  { path: "/docs/start/todos-tutorial", width: 1350, height: 940 },
  { path: "/docs/self-hosting/overview", width: 1350, height: 940 },
  { path: "/docs/sdk/script-tag", width: 412, height: 823 },
  { path: "/docs/dashboard/models", width: 412, height: 823 },
]) {
  test(`${path} loads without font-swap shifts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await page.route(/\.woff2(?:\?.*)?$/, async (route) => {
      if (route.request().resourceType() === "font") {
        await new Promise((resolve) => setTimeout(resolve, 750))
      }
      await route.continue()
    })
    await page.addInitScript(() => {
      let score = 0
      new PerformanceObserver((entries) => {
        for (const entry of entries.getEntries()) {
          const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean }
          if (!shift.hadRecentInput) score += shift.value
        }
      }).observe({ type: "layout-shift", buffered: true })
      Object.defineProperty(window, "docsLayoutShiftScore", { get: () => score })
    })

    await page.goto(path)
    await page.waitForFunction(
      () => !document.documentElement.classList.contains("docs-fonts-loading"),
    )
    const result = await page.evaluate(async () => {
      await document.fonts.ready
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      return {
        score: Number(Reflect.get(window, "docsLayoutShiftScore")),
        brandFontLoaded: Array.from(document.fonts).some(
          (font) =>
            font.family.replaceAll('"', "") === "Inter Variable" && font.status === "loaded",
        ),
      }
    })
    expect(result.brandFontLoaded).toBe(true)
    expect(result.score).toBeLessThan(0.005)
  })
}

test("docs remain readable when web font requests stall", async ({ page }) => {
  const blocked: Route[] = []
  await page.route(/\.woff2(?:\?.*)?$/, (route) => {
    if (route.request().resourceType() === "font") blocked.push(route)
    else void route.continue()
  })
  await page.goto("/docs/cli/getting-started", { waitUntil: "domcontentloaded" })
  const heading = page.getByRole("heading", { name: "Getting started", exact: true })
  await expect(heading).toBeHidden()
  await expect(heading).toBeVisible({ timeout: 4000 })
  expect(blocked.length).toBeGreaterThan(0)
  await Promise.all(blocked.map((route) => route.abort()))
  await expect(heading).toBeVisible()
})

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false })

  test("docs remain readable", async ({ page }) => {
    await page.goto("/docs/cli/getting-started")
    await expect(page.getByRole("heading", { name: "Getting started", exact: true })).toBeVisible()
  })
})
