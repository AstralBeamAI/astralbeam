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

test("docs and profile-menu website links point directly to the public landing page", async ({
  page,
  baseline,
  shell,
}) => {
  await page.goto(`/${baseline.organizationSlug}`)
  await shell.openUserMenu()
  const menuLink = page.getByRole("menuitem", { name: "Website", exact: true })
  await expect(menuLink).toHaveAttribute("href", "https://astralbeam.ai/home")
  await expect(menuLink).toHaveAttribute("target", "_blank")

  await page.goto("/docs")
  const docsLink = page.getByRole("navigation", { name: "Main" }).getByRole("link", {
    name: "Website",
    exact: true,
  })
  await expect(docsLink).toHaveAttribute("href", "https://astralbeam.ai/home")
  await expect(docsLink).toHaveAttribute("target", "_blank")
})

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test("an organization page sends a visitor to sign-in with its return path", async ({
    page,
    baseline,
  }) => {
    const guarded = `/${baseline.organizationSlug}/api-keys`
    await page.goto(guarded)
    await page.waitForURL(/\/auth\/sign-in/)
    expect(new URL(page.url()).searchParams.get("redirectTo")).toBe(guarded)
  })
})
