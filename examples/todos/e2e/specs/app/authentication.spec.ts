import { expect, test } from "../../fixtures.ts"
import { seedTarget } from "../../worktree.ts"
import { createAstralBeamToken } from "@astralbeam/sdk/server"

const fixture = new URL("../../fixtures/authentication.html", import.meta.url)

test("React layout refresh under Strict Mode waits for rows and renews rejected identity", async ({
  page,
}) => {
  let admin: boolean | undefined = true
  let issued = 0
  let synchronized = 0
  const rows = Promise.withResolvers<void>()
  const requested = page.waitForRequest("**/api/v1/tenants/*/tenant_users?*")
  await page.route("**/api/v1/tenants/*/tenant_users?*", async (route) => {
    await rows.promise
    await route.continue()
  })
  await page.route("**/__authentication-token", async (route) => {
    issued++
    const token = await createAstralBeamToken({
      apiKey: seedTarget.apiKey,
      tenant: seedTarget.tenant,
      user: { ...seedTarget.user, admin },
    })
    await route.fulfill({ json: { token } })
  })
  await page.route("**/api/v1/me", (route) => {
    synchronized++
    return synchronized === 1
      ? route.fulfill({ status: 401, json: { status: 401, detail: "Renew identity" } })
      : route.continue()
  })
  await page.goto(`/@fs${fixture.pathname}`)
  await requested
  await expect(page.getByLabel("Host refresh")).toHaveText("pending")
  rows.resolve()
  await expect(page.getByLabel("Host refresh")).toHaveText("fulfilled")
  await expect(page.getByLabel("Host errors")).toHaveText("0")
  await expect(page.getByText(seedTarget.user.name, { exact: true })).toBeVisible()
  expect(issued).toBe(2)
  expect(synchronized).toBe(2)
  admin = undefined
  await page.route(
    "**/api/v1/tenants/*/tenant_users?*",
    (route) => route.fulfill({ status: 401, json: { status: 401, detail: "Renew permissions" } }),
    {
      times: 1,
    },
  )
  const refreshed = page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/me") && response.ok(),
  )
  await page.getByRole("button", { name: "Refresh directory", exact: true }).click()
  const currentUser = (await (await refreshed).json()) as { user: { admin?: boolean } }
  expect(currentUser.user.admin).toBe(true)
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByText(seedTarget.user.name, { exact: true })).toHaveCount(0)
})

test("host callbacks and refresh recover initial and background authentication failures", async ({
  page,
}) => {
  await page.clock.install()
  let denied = true
  await page.route("**/__authentication-token", async (route) => {
    const token = await createAstralBeamToken({
      apiKey: seedTarget.apiKey,
      tenant: seedTarget.tenant,
      user: { ...seedTarget.user, admin: true },
    })
    await route.fulfill({ json: { token } })
  })
  await page.route("**/api/v1/me", (route) =>
    denied ? route.fulfill({ status: 403, json: {} }) : route.continue(),
  )
  await page.goto(`/@fs${fixture.pathname}`)
  const row = page.getByText(seedTarget.user.name, { exact: true })
  const errors = page.getByLabel("Host errors")
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(errors).toHaveText("1")
  await expect(page.getByLabel("Host refresh")).toHaveText("AstralBeamApiError")
  denied = false
  await page.getByRole("button", { name: "Refresh from host", exact: true }).click()
  await expect(row).toBeVisible()
  await expect(page.getByLabel("Host refresh")).toHaveText("fulfilled")
  denied = true
  await page.clock.fastForward(61_000)
  await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")))
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(errors).toHaveText("2")
  denied = false
  await page.getByRole("button", { name: "Refresh from host", exact: true }).click()
  await expect(row).toBeVisible()
  await expect(errors).toHaveText("2")
  await expect(page.getByLabel("Host refresh")).toHaveText("fulfilled")
  await page.route("**/api/v1/tenants/*/tenant_users?*", (route) =>
    route.fulfill({ status: 403, json: {} }),
  )
  await page.getByRole("button", { name: "Refresh from host", exact: true }).click()
  await expect(page.getByLabel("Host refresh")).toHaveText("AstralBeamApiError")
  await expect(errors).toHaveText("3")
})
