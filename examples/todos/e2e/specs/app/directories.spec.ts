import { expect, test } from "../../fixtures.ts"
import { directoriesPage, openVanillaDirectories } from "../../pages/directories-page.ts"
import { captureMoment } from "../../capture.ts"
import { SEED_ORGANIZATIONS, SEED_USERS } from "../../../../../platform/scripts/seed/fixtures.ts"
// @deno-types="../../../../../sdk/dist/server.d.ts"
import {
  createAstralBeamOrganizationToken,
  createAstralBeamToken,
} from "../../../../../sdk/dist/server.js"
import { seedTarget } from "../../worktree.ts"

test("example lists only its tenant's users and filters stored admin status", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const directory = directoriesPage(page)
  const tenant = SEED_ORGANIZATIONS[0].tenants[0]
  const [admin] = tenant.users
  await directory.open()
  await expect(directory.user(admin.name)).toBeVisible()
  await expect(directory.tenantPicker).toHaveCount(0)
  await expect(directory.user(SEED_ORGANIZATIONS[0].tenants[1].users[0].name)).toHaveCount(0)
  await expect(directory.adminFilter).toHaveCount(0)
  await captureMoment(page, "tenant-users-page")
  await expect(directory.tenantContext).toContainText(tenant.name)
  await directory.showAdmin.check()
  await directory.adminFilter.selectOption("false")
  await expect(directory.user(admin.name)).toHaveCount(0)
  await directory.adminFilter.selectOption("true")
  await directory.user(admin.name).click()
  await expect(directory.metadata).toContainText(admin.metadata.email)
  await captureMoment(page, "filtered-user-details")
  await directory.showAdmin.uncheck()
  await expect(directory.adminFilter).toHaveCount(0)
  await expect(directory.user(admin.name)).toBeVisible()
})

test("a missing tenant can be refreshed after provisioning without remounting", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  await page.route("**/api/v1/tenants?*", (route) =>
    route.fulfill({ json: { items: [], page_after: null, page_before: null } }),
  )
  await directory.open()
  await expect(directory.users).toContainText("No persisted tenant found")
  await captureMoment(page, "missing-tenant-refresh")
  await page.unroute("**/api/v1/tenants?*")
  await directory.refresh.click()
  await expect(directory.user(seedTarget.user.name)).toBeVisible()
})

test("directories share chat theme tokens across system, dark, and removed overrides", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" })
  const directory = directoriesPage(page)
  const tenant = SEED_ORGANIZATIONS[0].tenants[0]
  await directory.open()
  await expect(directory.userTable).toHaveCSS("background-color", "rgb(253, 249, 240)")
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(directory.userTable).toHaveCSS("background-color", "rgb(43, 36, 22)")
  await captureMoment(page, "tenant-users-shared-dark-theme")
  await directory.theme.click()
  await expect(directory.userTable).toHaveCSS("background-color", "rgb(253, 249, 240)")
  await directory.customTheme.click()
  await expect(directory.userTable).toHaveCSS("background-color", /^oklch\((1|100%) 0 0\)$/)
  await expect(directory.user(tenant.users[0].name)).toBeVisible()
  await directory.customTheme.click()
  await expect(directory.userTable).toHaveCSS("background-color", "rgb(253, 249, 240)")
})

test("terminal API failures reach the host without losing the widget error UI", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  await page.route("**/api/v1/tenants/*/tenant_users?*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/problem+json",
      body: JSON.stringify({
        type: "about:blank",
        title: "Forbidden",
        status: 403,
        detail: "Directory access denied",
      }),
    }),
  )
  await directory.open()
  await expect(directory.error).toContainText("Directory error: Directory access denied")
  await expect(directory.users.getByText("Directory access denied")).toBeVisible()
  await page.unroute("**/api/v1/tenants/*/tenant_users?*")
  await directory.retry.click()
  await expect(directory.user(seedTarget.user.name)).toBeVisible()
  await captureMoment(page, "recovered-directory-dismissible-error")
  await directory.dismissError.click()
  await expect(directory.error).toHaveCount(0)
})

test("vanilla tenant directories enforce admin authority across reset and remount", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  const tenant = SEED_ORGANIZATIONS[0].tenants[1]
  const [admin, member] = tenant.users
  const adminTarget = {
    apiKey: seedTarget.apiKey,
    tenant: { id: tenant.externalId, name: tenant.name },
    user: { id: admin.externalId, name: admin.name, admin: admin.admin, metadata: admin.metadata },
  }
  const memberTarget = {
    ...adminTarget,
    user: {
      id: member.externalId,
      name: member.name,
      admin: member.admin,
      metadata: member.metadata,
    },
  }
  let token = await createAstralBeamToken(adminTarget)
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await openVanillaDirectories(page)
  await expect(directory.tenant(tenant.name)).toBeVisible()
  await expect(directory.user(admin.name)).toBeVisible()
  await expect(directory.tenant(seedTarget.tenant.name)).toHaveCount(0)
  await directory.unmount.click()
  await expect(directory.tenants).toHaveCount(0)
  await expect(directory.users).toHaveCount(0)
  await directory.remount.click()
  await expect(directory.user(admin.name)).toBeVisible()

  token = await createAstralBeamToken(memberTarget)
  const denied = page.waitForResponse(
    (response) => response.url().includes("/api/v1/tenants") && response.status() === 403,
  )
  await directory.reset.click()
  await denied
  await expect(directory.users).toContainText("Access denied")
  await expect(directory.user(admin.name)).toHaveCount(0)
  token = await createAstralBeamToken(adminTarget)
  await directory.reset.click()
  await expect(directory.user(admin.name)).toBeVisible()
  await captureMoment(page, "vanilla-tenant-directories")
})

test("directory table and tenant search follow real server cursors", async ({ page }) => {
  const directory = directoriesPage(page)
  const token = await createAstralBeamOrganizationToken({
    apiKey: seedTarget.apiKey,
    organizationId: seedTarget.organizationId,
    email: SEED_USERS[0].email,
  })
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await page.route("**/api/v1/tenants?*", async (route) => {
    const url = new URL(route.request().url())
    url.searchParams.set("page_size", "1")
    await route.fulfill({ response: await route.fetch({ url: url.href }) })
  })
  const [first, second] = SEED_ORGANIZATIONS[0].tenants
  await openVanillaDirectories(page, { scope: "organization" })
  await expect(directory.tenant(first.name)).toBeVisible()
  await directory.next.click()
  await expect(directory.tenant(second.name)).toBeVisible()
  await expect(directory.tenant(first.name)).toHaveCount(0)
  await directory.previous.click()
  await expect(directory.tenant(first.name)).toBeVisible()
  await expect(directory.tenant(second.name)).toHaveCount(0)
  const searched = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("q") === "o",
  )
  await directory.tenantPicker.fill("o")
  await searched
  await directory.loadMore.click()
  await directory.tenantOption(second.name).click()
  await expect(directory.user(second.users[0].name)).toBeVisible()
  await directory.tenantPicker.fill("missing-tenant-for-search")
  await expect(directory.users.getByText("No tenants match.")).toBeVisible()
  await expect(directory.tenantContext).toContainText(second.name)
  await directory.clearTenant.click()
  await expect(directory.user(second.users[0].name)).toHaveCount(0)
  await directory.selectTenant(first.name)
  await expect(directory.user(first.users[0].name)).toBeVisible()
  await captureMoment(page, "tenant-search-real-cursors")
})

test("external tenant IDs resolve exactly and missing tenants never show another tenant's users", async ({
  page,
}) => {
  const directory = directoriesPage(page)
  const tenant = SEED_ORGANIZATIONS[0].tenants[1]
  const token = await createAstralBeamOrganizationToken({
    apiKey: seedTarget.apiKey,
    organizationId: seedTarget.organizationId,
    email: SEED_USERS[0].email,
  })
  await page.route("**/__listing-token", (route) => route.fulfill({ json: { token } }))
  await openVanillaDirectories(page, { scope: "organization", tenantExternalId: tenant.externalId })
  await expect(directory.user(tenant.users[0].name)).toBeVisible()
  await expect(directory.tenantContext).toContainText(tenant.name)
  await expect(directory.tenantPicker).toHaveCount(0)
  await openVanillaDirectories(page, {
    scope: "organization",
    tenantExternalId: "missing-tenant-for-lookup",
  })
  await expect(directory.users).toContainText("No persisted tenant found")
  await expect(directory.user(tenant.users[0].name)).toHaveCount(0)
})
