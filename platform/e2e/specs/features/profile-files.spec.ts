import { readFileSync } from "node:fs"
import { hashPassword } from "better-auth/crypto"
import { Pool } from "pg"

import { SEED_PASSWORD } from "../../../scripts/seed/fixtures.ts"

import { authPage } from "../../pages/auth-page.ts"
import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { startBrowserStorageFixture, stopBrowserStorageFixture } from "../../object-storage.ts"
import { e2eDatabaseUrl, operatorKey, platformUrl } from "../../worktree.ts"

test("avatars and existing logo APIs store files privately and enforce their ownership", async ({
  page,
  browser,
  baseline,
  configure,
  userSettings,
}) => {
  const authTransactions: number[] = []
  const pool = new Pool({ connectionString: e2eDatabaseUrl, max: 1 })
  const storageFixture = {
    objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
    corrupt: false,
    inspect: async () => {
      const result = await pool.query<{ count: number }>(
        "select count(*)::integer as count from pg_stat_activity where datname = current_database() and application_name = 'astralbeam-platform-auth' and state = 'idle in transaction'",
      )
      authTransactions.push(result.rows[0]!.count)
    },
  }
  const { server, endpoint } = await startBrowserStorageFixture(storageFixture)
  const png = readFileSync(new URL("../../../public/astralbeam-logo-light.png", import.meta.url))
  try {
    await configure.open()
    await configure.signIn(operatorKey)
    await configure.setValue("s3_endpoint", endpoint)
    await configure.save()
    await userSettings.openAccount()
    await userSettings.uploadAvatar(png)
    await expect(userSettings.avatarImage()).toBeVisible()
    const avatarUrl = await userSettings.avatarImage().getAttribute("src")
    expect(avatarUrl).toMatch(/^\/api\/files\/avatars\//)
    const avatar = await page.request.get(avatarUrl!)
    expect(avatar.status()).toBe(200)
    expect(avatar.headers()["cache-control"]).toBe("private, no-store")
    await page.reload()
    await expect(userSettings.avatarImage()).toHaveAttribute("src", avatarUrl!)
    await captureMilestone(page, "stored-avatar-after-reload")
    const inline = await page.request.post("/api/auth/update-user", {
      headers: { origin: platformUrl },
      data: { image: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(inline.status()).toBe(400)
    const foreign = await page.request.post("/api/auth/update-user", {
      headers: { origin: platformUrl },
      data: { image: "/api/files/avatars/019d0000-0000-7000-8000-000000000000" },
    })
    expect(foreign.status()).toBe(400)
    const malformed = await page.request.post("/api/auth/update-user", {
      headers: { origin: platformUrl },
      data: { image: "/api/files/avatars/------------------------------------" },
    })
    expect(malformed.status()).toBe(400)
    const sessionResponse = await page.request.get("/api/auth/get-session")
    const session = (await sessionResponse.json()) as {
      session: { activeOrganizationId: string | null }
      user: { image: string }
    }
    expect(session.user.image).toBe(avatarUrl)
    const organizations = (await (
      await page.request.get("/api/auth/organization/list")
    ).json()) as { id: string; slug: string }[]
    const organizationId = organizations.find(
      (organization) => organization.slug === baseline.organizationSlug,
    )!.id
    const logoResponse = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: {
        organizationId,
        data: { logo: `data:image/png;base64,${png.toString("base64")}` },
      },
    })
    expect(logoResponse.status()).toBe(200)
    const logo = (await logoResponse.json()) as { logo: string }
    expect(logo.logo).toMatch(/^\/api\/files\/organizations\//)
    expect(await (await page.request.get(logo.logo)).body()).toEqual(png)
    expect(authTransactions.length).toBeGreaterThan(0)
    expect(authTransactions.every((count) => count === 0)).toBe(true)
    const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      expect((await signedOut.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
        401,
      )
      expect((await signedOut.request.get(new URL(logo.logo, platformUrl).href)).status()).toBe(401)
    } finally {
      await signedOut.close()
    }
    const colleagueEmail = `colleague-${crypto.randomUUID()}@e2e.test`
    const colleagueUser = await pool.query<{ id: string }>(
      'insert into "user" (email, name, email_verified) values ($1, $2, true) returning id',
      [colleagueEmail, "Storage colleague"],
    )
    const colleagueId = colleagueUser.rows[0]!.id
    await pool.query(
      "insert into account (account_id, provider_id, user_id, password) values ($1::text, 'credential', $1::uuid, $2)",
      [colleagueId, await hashPassword(SEED_PASSWORD)],
    )
    const colleague = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      const colleaguePage = await colleague.newPage()
      const auth = authPage(colleaguePage)
      await auth.open("sign-in")
      await auth.signIn(colleagueEmail, SEED_PASSWORD)
      await expect(colleaguePage).not.toHaveURL(/\/auth\//)
      expect((await colleague.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
        404,
      )
      const member = await pool.query<{ id: string }>(
        "insert into member (organization_id, user_id, role) select $1, id, 'member' from \"user\" where email = $2 returning id",
        [organizationId, colleagueEmail],
      )
      try {
        expect((await colleague.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
          200,
        )
        expect((await colleague.request.get(new URL(logo.logo, platformUrl).href)).status()).toBe(
          200,
        )
      } finally {
        await pool.query("delete from member where id = $1", [member.rows[0]!.id])
      }
      expect((await colleague.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
        404,
      )
      expect((await colleague.request.get(new URL(logo.logo, platformUrl).href)).status()).toBe(404)
    } finally {
      await colleague.close()
      await pool.query('delete from "user" where id = $1', [colleagueId])
    }
    const queuedLogo = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: { organizationId, data: { logo: "https://example.com/pending-logo.png" } },
    })
    expect(queuedLogo.status()).toBe(200)
    const clearedLogo = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: { organizationId, data: { logo: null } },
    })
    expect(clearedLogo.status()).toBe(200)
    const cancelled = await pool.query<{ status: string }>(
      "select status from organization_image_import where organization_id = $1",
      [organizationId],
    )
    expect(cancelled.rows[0]!.status).toBe("disabled")
    await userSettings.removeAvatar()
    expect((await page.request.get(avatarUrl!)).status()).toBe(404)
  } finally {
    await stopBrowserStorageFixture(server)
    await pool.end()
  }
})
