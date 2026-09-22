import { expect, test } from "../../fixtures.ts"
import { seedTarget } from "../../worktree.ts"
// @deno-types="../../../../../sdk/dist/server.d.ts"
import { createAstralBeamToken } from "../../../../../sdk/dist/server.js"
import type { Page } from "@playwright/test"

async function openAuthentication(page: Page) {
  await page.route(
    "**/*",
    (route) => route.request().resourceType() === "script" ? route.abort() : route.continue(),
  )
  await page.goto("/")
  await page.unroute("**/*")
  await page.setContent(
    '<html><title>Standalone authentication</title><div id="authentication-root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; await import("/e2e/fixtures/authentication.tsx");</script></html>',
  )
}

test("standalone function props synchronize current user and refresh on rejection", async ({ page }) => {
  let admin: boolean | undefined = true
  let issued = 0
  let synchronized = 0
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
  await openAuthentication(page)
  await expect(page.getByRole("button", { name: seedTarget.user.name, exact: true })).toBeVisible()
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
  const refreshed = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/me") && response.ok()
  )
  await page.getByRole("button", { name: "Refresh directory", exact: true }).click()
  expect((await (await refreshed).json()).user.admin).toBe(true)
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(page.getByRole("button", { name: seedTarget.user.name, exact: true })).toHaveCount(0)
})

test("host callbacks and refresh recover initial and background authentication failures", async ({ page }) => {
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
  await page.route(
    "**/api/v1/me",
    (route) => denied ? route.fulfill({ status: 403, json: {} }) : route.continue(),
  )
  await openAuthentication(page)
  const row = page.getByRole("button", { name: seedTarget.user.name, exact: true })
  const errors = page.getByLabel("Host errors")
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(errors).toHaveText("1")
  denied = false
  await page.getByRole("button", { name: "Refresh from host", exact: true }).click()
  await expect(row).toBeVisible()
  denied = true
  await page.clock.fastForward(61_000)
  await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")))
  await expect(page.getByRole("alert")).toBeVisible()
  await expect(errors).toHaveText("2")
  denied = false
  await page.getByRole("button", { name: "Refresh from host", exact: true }).click()
  await expect(row).toBeVisible()
  await expect(errors).toHaveText("2")
})
