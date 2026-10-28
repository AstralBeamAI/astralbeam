import { expect, test } from "@e2e/fixtures.ts"

/**
 * A focused spec, written the way a later one should be: it takes the organization the journey
 * left behind from the `baseline` fixture and never repeats the journey's own setup.
 */

const ORGANIZATION_SECTIONS = [
  ["models", "Models"],
  ["agents", "Agents"],
  ["sandboxes", "Sandboxes"],
  ["usage-limits", "Usage Limits"],
  ["api-keys", "API keys"],
  ["members", "Members"],
  ["settings", "Organization settings"],
] as const

test("the owner reaches every organization section directly by URL", async ({ page, baseline }) => {
  for (const [segment, heading] of ORGANIZATION_SECTIONS) {
    await page.goto(`/${baseline.organizationSlug}/${segment}`)
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible()
  }
})

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("invalid organization slugs return 404 without redirecting to sign-in", async ({ page }) => {
    for (const path of ["/g,%60", "/llms-full.txt"]) {
      const response = await page.goto(path)
      expect(response?.status()).toBe(404)
      expect(new URL(page.url()).pathname).toBe(path)
      await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible()
    }
  })

  test("an organization page sends a visitor to sign-in with its return path", async ({
    page,
    baseline,
  }) => {
    const guarded = `/${baseline.organizationSlug}/api-keys`
    await page.goto(guarded)
    await page.waitForURL(/\/auth\/sign-in/)
    expect(new URL(page.url()).searchParams.get("redirectTo")).toBe(guarded)
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow")
  })
})
