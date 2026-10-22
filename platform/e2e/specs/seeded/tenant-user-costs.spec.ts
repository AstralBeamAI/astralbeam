import {
  createSeedDatabase,
  loadSeedEnvironment,
  resolveSeedDatabaseUrl,
} from "@scripts/seed/database.ts"
import { SEED_ORGANIZATIONS, SEED_PASSWORD, SEED_USERS } from "@scripts/seed/fixtures.ts"
import type { getTenantUserUsage, TenantUserPage } from "@sdk/api/generated/api.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("TenantUser monthly costs are visible to owners and omitted for viewers", async ({
  page,
  auth,
  shell,
}) => {
  test.setTimeout(90_000)
  loadSeedEnvironment()
  const { pool } = createSeedDatabase(resolveSeedDatabaseUrl().url)
  const organization = SEED_ORGANIZATIONS[0]
  const tenantName = `Monthly costs ${crypto.randomUUID()}`
  const created = await pool.query<{ id: string; external_id: string }>(
    `insert into tenant (organization_id, external_id, name)
     values ($1, $2, $2), ($1, $2 || '-other', $2 || '-other') returning id, external_id`,
    [organization.id, tenantName],
  )
  const tenantId = created.rows.find((row) => row.external_id === tenantName)!.id
  const otherTenantId = created.rows.find((row) => row.external_id !== tenantName)!.id
  try {
    await pool.query(
      `insert into tenant_user (organization_id, tenant_id, external_id, name, metadata)
       values ($1, $2, 'priced', 'Priced user', jsonb_build_object('details', repeat('Recorded customer context. ', 10))),
              ($1, $2, 'unpriced', 'Unpriced user', '{}'), ($1, $2, 'unused', 'Unused user', '{}')`,
      [organization.id, tenantId],
    )
    await pool.query(
      `insert into tenant_user (organization_id, tenant_id, id, external_id, name)
       select organization_id, $3, id, external_id, name from tenant_user
       where organization_id = $1 and tenant_id = $2 and external_id = 'priced'`,
      [organization.id, tenantId, otherTenantId],
    )
    await pool.query(
      `with threads as (
         insert into chat_thread (organization_id, tenant_id) values ($1, $2), ($1, $3)
         returning id, tenant_id
       ), inputs as (
         insert into chat_message (organization_id, tenant_id, thread_id, author_tenant_user_id, role, state, turn_state, metadata)
         select $1, u.tenant_id, t.id, u.id, 'user', 'complete', 'completed', '{"version":1}'
         from tenant_user u join threads t on t.tenant_id = u.tenant_id
         where u.organization_id = $1 and u.external_id != 'unused'
         returning id, tenant_id, thread_id, author_tenant_user_id
       )
       insert into chat_message (organization_id, tenant_id, thread_id, parent_message_id, turn_message_id, role, state, metadata, created_at)
       select $1, i.tenant_id, i.thread_id, i.id, i.id, 'assistant', 'complete',
         jsonb_build_object('version', 1, 'provenance', jsonb_build_object(
           'initiatorTenantUserId', u.id, 'usage', case when c.spend is null then '{}'::jsonb
             else jsonb_build_object('cost', c.spend) end)), c.created_at
       from inputs i join tenant_user u on u.organization_id = $1 and u.tenant_id = i.tenant_id and u.id = i.author_tenant_user_id
       join (values
         ('priced', 0.01, now()), ('priced', 0.0023, now()), ('unpriced', null, now()),
         ('priced', 7, (date_trunc('month', now() at time zone 'UTC') - interval '1 microsecond') at time zone 'UTC'),
         ('priced', 8, (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC')
       ) c(external_id, spend, created_at) on c.external_id = u.external_id`,
      [organization.id, tenantId, otherTenantId],
    )
    const listPath = `/api/v1/tenants/${tenantId}/tenant_users`
    const usagePath = `${listPath}/usage`
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let usageRequests = 0
    let usageStatus = 503
    await page.route(`**${usagePath}?**`, async (route) => {
      usageRequests++
      if (usageRequests === 1) {
        started.resolve()
        await release.promise
      }
      if (usageStatus === 200) return route.continue()
      await route.fulfill({
        status: usageStatus,
        json: { title: "Usage unavailable", status: usageStatus },
      })
    })
    const directory = page.locator('[data-slot="directory"]')
    const costHeader = directory.getByRole("columnheader", {
      name: "Usage (USD)",
      exact: true,
    })
    const userRow = (name: string) =>
      directory.getByRole("row").filter({ has: page.getByText(name, { exact: true }) })
    const openDirectory = async () => {
      await page.goto(`/${organization.slug}/tenant-users`)
      const response = page.waitForResponse((result) => new URL(result.url()).pathname === listPath)
      await directory.getByRole("combobox", { name: "Tenant", exact: true }).fill(tenantName)
      await page.getByRole("option", { name: tenantName, exact: true }).click()
      const result = await response
      expect(result.status()).toBe(200)
      return (await result.json()) as TenantUserPage
    }
    const waitForUsage = () =>
      page.waitForResponse((result) => new URL(result.url()).pathname === usagePath)
    const refresh = page.getByRole("button", { name: "Refresh directory", exact: true })
    const refreshUsage = async () => {
      const response = waitForUsage()
      await refresh.click()
      const result = await response
      await expect(refresh).toBeEnabled()
      return result
    }
    const filterUsers = async (q: string) => {
      const listed = page.waitForResponse((result) => {
        const url = new URL(result.url())
        return url.pathname === listPath && url.searchParams.get("q") === q
      })
      await directory.getByRole("searchbox").fill(q)
      await listed
      await expect(directory.getByRole("row")).toHaveCount(q ? 3 : 4)
    }
    await test.step("Rows and pagination remain usable while usage is slow or fails", async () => {
      const listed = await openDirectory()
      expect(listed.items).toHaveLength(3)
      await started.promise
      await expect(userRow("Priced user")).toBeVisible()
      await userRow("Priced user").getByText("Show full value", { exact: true }).click()
      await expect(userRow("Priced user").locator("details")).toHaveJSProperty("open", true)
      await expect(directory.getByRole("combobox", { name: "Rows per page" })).toBeEnabled()
      await expect(directory.getByText("Loading usage…", { exact: true })).toBeVisible()
      await captureMilestone(page, "tenant-user-costs-loading")
      release.resolve()
      await expect(directory.getByText("Unable to load usage", { exact: true })).toBeVisible()
      await expect(userRow("Priced user")).toBeVisible()
      await expect(directory.getByRole("combobox", { name: "Rows per page" })).toBeEnabled()
      await captureMilestone(page, "tenant-user-costs-error")
      usageStatus = 200
      const response = waitForUsage()
      await directory.getByRole("button", { name: "Retry", exact: true }).click()
      const result = await response
      expect(result.status()).toBe(200)
      const usage = (await result.json()) as Awaited<ReturnType<typeof getTenantUserUsage>>
      expect(new URL(result.url()).searchParams.get("user_ids")).toBe(
        listed.items
          .map(({ id }) => id)
          .toSorted()
          .join(","),
      )
      expect(
        Object.fromEntries(
          listed.items.map((user) => [
            user.external_id,
            usage.items.find((item) => item.tenant_user_id === user.id)?.cost_usd,
          ]),
        ),
      ).toEqual({ priced: "0.0123", unpriced: null, unused: "0" })
      await expect(costHeader).toBeVisible()
      await expect(userRow("Priced user")).toContainText("$0.0123")
      await expect(userRow("Unpriced user")).toContainText("Unavailable")
      await expect(userRow("Unused user")).toContainText("$0.00")
      await expect(userRow("Priced user").locator("details")).toHaveJSProperty("open", true)
      expect((await refreshUsage()).status()).toBe(200)
      await expect(userRow("Priced user").locator("details")).toHaveJSProperty("open", true)
      await captureMilestone(page, "tenant-user-costs-owner")
    })
    await test.step("Usage cache reuses pages, refreshes explicitly, and discards denied values", async () => {
      const filteredUsage = waitForUsage()
      await filterUsers("priced")
      expect((await filteredUsage).status()).toBe(200)
      await expect(userRow("Priced user")).toContainText("$0.0123")
      const requests = usageRequests
      await filterUsers("")
      await expect(userRow("Priced user")).toContainText("$0.0123")
      expect(usageRequests).toBe(requests)
      expect((await refreshUsage()).status()).toBe(200)
      expect(usageRequests).toBe(requests + 1)
      usageStatus = 403
      expect((await refreshUsage()).status()).toBe(403)
      await expect(costHeader).toHaveCount(0)
      await expect(userRow("Priced user")).toBeVisible()
      usageStatus = 503
      expect((await refreshUsage()).status()).toBe(503)
      await expect(costHeader).toHaveCount(0)
      await expect(directory.getByText("$0.0123", { exact: true })).toHaveCount(0)
      usageStatus = 403
      const deniedPage = waitForUsage()
      await filterUsers("priced")
      expect((await deniedPage).status()).toBe(403)
      await expect(directory.getByText("$0.0123", { exact: true })).toHaveCount(0)
      await expect(costHeader).toHaveCount(0)
      usageStatus = 200
      expect((await refreshUsage()).status()).toBe(200)
      await filterUsers("")
      expect((await refreshUsage()).status()).toBe(200)
      await expect(userRow("Priced user")).toContainText("$0.0123")
    })
    await test.step("Narrow directory keeps labeled costs within the screen", async () => {
      await page.setViewportSize({ width: 390, height: 844 })
      await expect(userRow("Priced user")).toContainText("Usage (USD)")
      await expect(userRow("Priced user").getByText("$0.0123", { exact: true })).toBeVisible()
      expect(
        await directory.evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await captureMilestone(page, "tenant-user-costs-mobile")
    })
    await test.step("Viewer loads users without a usage request or column", async () => {
      const requests = usageRequests
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.goto("/auth/sign-out")
      await page.waitForURL(/\/auth\/sign-in/)
      await auth.signIn(SEED_USERS[2].email, SEED_PASSWORD)
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"))
      await expect(shell.navigation).toBeVisible()
      const response = await openDirectory()
      expect(response.items).toHaveLength(3)
      await expect(userRow("Priced user")).toBeVisible()
      await expect(costHeader).toHaveCount(0)
      await expect(directory.getByText("Unavailable", { exact: true })).toHaveCount(0)
      expect(usageRequests).toBe(requests)
      await captureMilestone(page, "tenant-user-costs-viewer")
    })
  } finally {
    await pool.query("delete from tenant where organization_id = $1 and id = any($2::uuid[])", [
      organization.id,
      [tenantId, otherTenantId],
    ])
    await pool.end()
  }
})
