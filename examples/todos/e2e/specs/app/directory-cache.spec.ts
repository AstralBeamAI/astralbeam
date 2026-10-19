import { createAstralBeamToken } from "@astralbeam/sdk/server"
import type { TenantUserPage } from "../../../../../sdk/dist/api.js"
import { SEED_ORGANIZATIONS } from "../../../../../platform/scripts/seed/fixtures.ts"
import { expect, test } from "../../fixtures.ts"
import { directoriesPage, openVanillaDirectories } from "../../pages/directories-page.ts"
import { seedTarget } from "../../worktree.ts"

test("directories refresh stale data on focus and reconnect without refetching fresh data", async ({
  page,
  context,
}) => {
  await page.clock.install()
  const directory = directoriesPage(page)
  const token = await createAstralBeamToken(seedTarget)
  let lists = 0
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await page.route("**/api/v1/tenants/*/tenant_users?*", async (route) => {
    lists++
    const response = await route.fetch()
    const data = (await response.json()) as TenantUserPage
    data.items.find((item) => item.name === seedTarget.user.name)!.name = `Updated user ${lists}`
    await route.fulfill({ response, json: data })
  })
  await openVanillaDirectories(page, { scope: "tenant", cache: true }, ["users"])
  await expect(directory.user("Updated user 1")).toBeVisible()

  await page.evaluate(() => globalThis.dispatchEvent(new Event("visibilitychange")))
  await context.setOffline(true)
  await context.setOffline(false)
  await page.clock.runFor(100)
  expect(lists).toBe(1)

  await page.clock.fastForward(31_000)
  await page.evaluate(() => globalThis.dispatchEvent(new Event("visibilitychange")))
  await expect(directory.user("Updated user 2")).toBeVisible()
  expect(lists).toBe(2)

  await context.setOffline(true)
  await page.clock.fastForward(31_000)
  await context.setOffline(false)
  await expect(directory.user("Updated user 3")).toBeVisible()
  expect(lists).toBe(3)

  await directory.unmount.click()
  await page.clock.fastForward(31_000)
  await context.setOffline(true)
  await context.setOffline(false)
  await page.clock.runFor(100)
  expect(lists).toBe(3)
})

test("retained directories reuse data after authentication, refresh and isolate identities", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  const tenant = SEED_ORGANIZATIONS[0].tenants[1]
  const [admin] = tenant.users
  const renamed = `${seedTarget.user.name} refreshed`
  let token = await createAstralBeamToken(seedTarget)
  let tokens = 0
  let sessions = 0
  let lists = 0
  let refresh = false
  let changingIdentity = false
  const authentication = Promise.withResolvers<void>()
  const nextIdentityRows = Promise.withResolvers<void>()
  await page.route("**/__listing-token", async (route) => {
    tokens++
    if (changingIdentity) await authentication.promise
    await route.fulfill({ json: { token } })
  })
  await page.route("**/api/v1/me", async (route) => {
    sessions++
    await route.continue()
  })
  await page.route("**/api/v1/tenants/*/tenant_users?*", async (route) => {
    lists++
    if (changingIdentity) await nextIdentityRows.promise
    const response = await route.fetch()
    const data = (await response.json()) as TenantUserPage
    if (refresh && !changingIdentity) {
      const user = data.items.find((item) => item.name === seedTarget.user.name)!
      user.name = renamed
    }
    await route.fulfill({ response, json: data })
  })
  await openVanillaDirectories(page, { scope: "tenant", cache: true }, ["users"])
  await expect(directory.user(seedTarget.user.name)).toBeVisible()
  expect({ tokens, sessions, lists }).toEqual({ tokens: 1, sessions: 1, lists: 1 })

  await directory.unmount.click()
  await expect(directory.users).toHaveCount(0)
  await directory.remount.click()
  await expect(directory.user(seedTarget.user.name)).toBeVisible()
  expect({ tokens, sessions, lists }).toEqual({ tokens: 2, sessions: 2, lists: 1 })

  refresh = true
  await directory.refresh.click()
  await expect(directory.user(renamed)).toBeVisible()
  expect(lists).toBe(2)

  token = await createAstralBeamToken({
    apiKey: seedTarget.apiKey,
    tenant: { id: tenant.externalId, name: tenant.name },
    user: { id: admin.externalId, name: admin.name, admin: admin.admin, metadata: admin.metadata },
  })
  changingIdentity = true
  await directory.remount.click()
  await expect.poll(() => tokens).toBe(3)
  await expect(directory.user(renamed)).toHaveCount(0)
  authentication.resolve()
  await expect.poll(() => lists).toBe(3)
  await expect(directory.user(renamed)).toHaveCount(0)
  nextIdentityRows.resolve()
  await expect(directory.user(admin.name)).toBeVisible()
  await expect(directory.user(seedTarget.user.name)).toHaveCount(0)
  expect({ tokens, sessions, lists }).toEqual({ tokens: 3, sessions: 3, lists: 3 })
})
