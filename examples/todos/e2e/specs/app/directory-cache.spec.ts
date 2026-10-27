import { createAstralBeamOrganizationToken, createAstralBeamToken } from "@astralbeam/sdk/server"
import type { TenantUserPage } from "../../../../../sdk/dist/api.js"
import { SEED_ORGANIZATIONS, SEED_USERS } from "../../../../../platform/scripts/seed/fixtures.ts"
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

test("host refresh waits for authentication, directory rows and their changed users' usage", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  const token = await createAstralBeamOrganizationToken({
    apiKey: seedTarget.apiKey,
    organizationId: seedTarget.organizationId,
    email: SEED_USERS[0].email,
  })
  const authentication = Promise.withResolvers<void>()
  const tenant = Promise.withResolvers<void>()
  const rows = Promise.withResolvers<void>()
  const usage = Promise.withResolvers<void>()
  const changedId = crypto.randomUUID()
  let refresh = false
  let stage = ""
  await page.route("**/__listing-token", async (route) => {
    stage = "authentication"
    await authentication.promise
    await route.fulfill({ json: { token } })
  })
  await page.route("**/api/v1/tenants?*", async (route) => {
    stage = "tenant"
    await tenant.promise
    await route.continue()
  })
  await page.route("**/api/v1/tenants/*/tenant_users?*", async (route) => {
    stage = "rows"
    await rows.promise
    const response = await route.fetch()
    const data = (await response.json()) as TenantUserPage
    if (refresh) {
      const user = data.items.find((item) => item.name === seedTarget.user.name)!
      user.id = changedId
      user.name = "Refreshed user"
    }
    await route.fulfill({ response, json: data })
  })
  await page.route("**/api/v1/tenants/*/tenant_users/usage?*", async (route) => {
    const params = new URL(route.request().url()).searchParams
    const ids = params.get("user_ids")!.split(",")
    if (ids.includes(changedId)) {
      stage = "usage"
      await usage.promise
    }
    await route.fulfill({
      json: {
        start: params.get("start"),
        end: params.get("end"),
        items: ids.map((id) => ({ tenant_user_id: id, cost_usd: "1.25" })),
      },
    })
  })
  await openVanillaDirectories(
    page,
    { initialAction: "refresh", tenantExternalId: seedTarget.tenant.id },
    ["users"],
  )
  const command = directory.commands.first()
  for (const [expected, gate] of Object.entries({ authentication, tenant, rows })) {
    await expect.poll(() => stage).toBe(expected)
    await expect(command).toHaveText("pending")
    gate.resolve()
  }
  await expect(command).toHaveText("fulfilled")
  await expect(directory.user(seedTarget.user.name)).toBeVisible()
  refresh = true
  const refreshed = await directory.runCommand("refresh")
  await expect.poll(() => stage).toBe("usage")
  await expect(directory.user("Refreshed user")).toBeVisible()
  await expect(refreshed).toHaveText("pending")
  usage.resolve()
  await expect(refreshed).toHaveText("fulfilled")
})

test("new refreshes, reset and unmount cancel older host commands and discard late rows", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  const token = await createAstralBeamToken(seedTarget)
  let hold: Promise<void> | undefined
  let name: string = seedTarget.user.name
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await page.route("**/api/v1/tenants/*/tenant_users?*", async (route) => {
    const blocked = hold
    const currentName = name
    const response = await route.fetch()
    const data = (await response.json()) as TenantUserPage
    data.items.find((user) => user.external_id === seedTarget.user.id)!.name = currentName
    await blocked
    await route.fulfill({ response, json: data })
  })
  await openVanillaDirectories(page, {}, ["users"])
  await expect(directory.user(name)).toBeVisible()

  for (const replacement of ["refresh", "reset", "unmount"] as const) {
    const blocked = Promise.withResolvers<void>()
    hold = blocked.promise
    name = `Stale ${replacement}`
    const requested = page.waitForRequest("**/api/v1/tenants/*/tenant_users?*")
    const previous = await directory.runCommand("refresh")
    await requested
    hold = undefined
    name = `Current ${replacement}`
    const command = replacement === "unmount" ? null : await directory.runCommand(replacement)
    if (!command) await directory.unmount.click()
    await expect(previous).toHaveText("AbortError")
    blocked.resolve()
    if (!command) await expect(directory.users).toHaveCount(0)
    else {
      await expect(command).toHaveText("fulfilled")
      await expect(directory.user(name)).toBeVisible()
      await expect(directory.user(`Stale ${replacement}`)).toHaveCount(0)
    }
  }
  await expect(directory.hostErrors).toHaveText("0")
})
