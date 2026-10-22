import {
  createSeedDatabase,
  loadSeedEnvironment,
  resolveSeedDatabaseUrl,
} from "@scripts/seed/database.ts"
import { SEED_ORGANIZATIONS, SEED_PASSWORD, SEED_USERS } from "@scripts/seed/fixtures.ts"
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
  const tenantId = crypto.randomUUID()
  const otherTenantId = crypto.randomUUID()
  const tenantName = `Monthly costs ${tenantId}`
  await pool.query(
    `insert into tenant (organization_id, id, external_id, name)
     values ($1, $2, $4, $4), ($1, $3, $4 || '-other', $4 || '-other')`,
    [organization.id, tenantId, otherTenantId, tenantName],
  )
  try {
    await pool.query(
      `insert into tenant_user (organization_id, tenant_id, id, external_id, name, metadata)
       values ($1, $2, $4, 'priced', 'Priced user', jsonb_build_object('details', repeat('Recorded customer context. ', 10))),
              ($1, $3, $4, 'priced', 'Priced user', '{}'),
              ($1, $2, default, 'unpriced', 'Unpriced user', '{}'), ($1, $2, default, 'unused', 'Unused user', '{}'),
              ($1, $2, default, 'small', 'Small usage', '{}')`,
      [organization.id, tenantId, otherTenantId, crypto.randomUUID()],
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
         ('priced', 0.01, now()), ('priced', 0.0023, now()), ('small', 0.00001, now()), ('unpriced', null, now()),
         ('priced', 7, (date_trunc('month', now() at time zone 'UTC') - interval '1 microsecond') at time zone 'UTC'),
         ('priced', 8, (date_trunc('month', now() at time zone 'UTC') + interval '1 month') at time zone 'UTC')
       ) c(external_id, spend, created_at) on c.external_id = u.external_id`,
      [organization.id, tenantId, otherTenantId],
    )
    const usagePath = `/api/v1/tenants/${tenantId}/tenant_users/usage`
    const release = Promise.withResolvers<void>()
    let usageRequests = 0
    let usageStatus = 503
    await page.route(`**${usagePath}?**`, async (route) => {
      if (++usageRequests === 1) await release.promise
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
    const selectTenant = async () => {
      await directory.getByRole("combobox", { name: "Tenant", exact: true }).fill(tenantName)
      await page.getByRole("option", { name: tenantName, exact: true }).click()
    }
    const refresh = page.getByRole("button", { name: "Refresh directory", exact: true })
    const refreshUsage = async (status = 200) => {
      usageStatus = status
      const response = page.waitForResponse(
        (result) => new URL(result.url()).pathname === usagePath,
      )
      await refresh.click()
      await response
      await expect(refresh).toBeEnabled()
    }
    const filterUsers = async (q: string) => {
      await directory.getByRole("searchbox").fill(q)
      await expect(directory.getByRole("row")).toHaveCount(q ? 3 : 5)
    }
    await test.step("Rows and pagination remain usable while usage is slow or fails", async () => {
      const started = page.waitForRequest(`**${usagePath}?**`)
      await page.goto(`/${organization.slug}/tenant-users`)
      await selectTenant()
      await started
      await userRow("Priced user").getByText("Show full value", { exact: true }).click()
      await expect(directory.getByRole("combobox", { name: "Rows per page" })).toBeEnabled()
      await expect(directory.getByText("Loading usage…", { exact: true })).toBeVisible()
      const month = new Date().toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
      await expect(
        directory.getByText(`Usage (USD) · ${month} · UTC`, { exact: true }),
      ).toBeVisible()
      await captureMilestone(page, "tenant-user-costs-loading")
      release.resolve()
      await expect(directory.getByText("Unable to load usage", { exact: true })).toBeVisible()
      await expect(costHeader).toBeVisible()
      await expect(userRow("Priced user")).toBeVisible()
      await expect(directory.getByRole("combobox", { name: "Rows per page" })).toBeEnabled()
      await captureMilestone(page, "tenant-user-costs-error")
      usageStatus = 200
      await directory.getByRole("button", { name: "Retry", exact: true }).click()
      await expect(costHeader).toBeVisible()
      await expect(userRow("Priced user")).toContainText("$0.0123")
      await expect(userRow("Unpriced user")).toContainText("Unavailable")
      await expect(userRow("Unused user")).toContainText("$0.00")
      await expect(userRow("Small usage").getByText("<$0.0001", { exact: true })).toHaveAttribute(
        "title",
        "0.00001 USD",
      )
      await expect(userRow("Priced user").locator("details")).toHaveJSProperty("open", true)
      await refreshUsage()
      await expect(userRow("Priced user").locator("details")).toHaveJSProperty("open", true)
      await captureMilestone(page, "tenant-user-costs-owner")
    })
    await test.step("Usage cache reuses pages, refreshes explicitly, and discards denied values", async () => {
      const retainedRequests = usageRequests
      await shell.sectionLink("Dashboard").click()
      await expect(directory).toHaveCount(0)
      await shell.navigation.getByRole("link", { name: "Tenant users", exact: true }).click()
      await selectTenant()
      await expect(userRow("Priced user")).toContainText("$0.0123")
      await expect(refresh).toBeEnabled()
      expect(usageRequests).toBe(retainedRequests)
      await filterUsers("priced")
      await expect(userRow("Priced user")).toContainText("$0.0123")
      const requests = usageRequests
      await filterUsers("")
      await expect(userRow("Priced user")).toContainText("$0.0123")
      expect(usageRequests).toBe(requests)
      await refreshUsage()
      expect(usageRequests).toBe(requests + 1)
      for (const status of [403, 503]) {
        await refreshUsage(status)
        await expect(costHeader).toHaveCount(status === 403 ? 0 : 1)
        await expect(directory.getByText("$0.0123", { exact: true })).toHaveCount(0)
      }
      await expect(userRow("Priced user")).toBeVisible()
      usageStatus = 403
      await filterUsers("priced")
      await expect(directory.getByText("$0.0123", { exact: true })).toHaveCount(0)
      await expect(costHeader).toHaveCount(0)
      await refreshUsage()
      await filterUsers("")
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
      await page.goto(`/${organization.slug}/tenant-users`)
      await selectTenant()
      await expect(userRow("Priced user")).toBeVisible()
      await expect(costHeader).toHaveCount(0)
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
