import { readFileSync } from "node:fs"
import { hashPassword } from "better-auth/crypto"
import { Pool } from "pg"

import { SEED_PASSWORD } from "@scripts/seed/fixtures.ts"
import { logoFileUrl } from "@/lib/organizations/images.ts"

import { authPage } from "@e2e/pages/auth-page.ts"
import { membersPage } from "@e2e/pages/members-page.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { startBrowserStorageFixture, stopBrowserStorageFixture } from "@e2e/object-storage.ts"
import { e2eDatabaseUrl, operatorKey, platformUrl } from "@e2e/worktree.ts"

test("avatars and existing logo APIs store files privately and enforce their ownership", async ({
  page,
  browser,
  baseline,
  configure,
  shell,
  userSettings,
  members,
}) => {
  test.setTimeout(60_000)
  const pool = new Pool({ connectionString: e2eDatabaseUrl, max: 1 })
  const storageFixture = {
    objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
    corrupt: false,
  }
  const { server, endpoint } = await startBrowserStorageFixture(storageFixture)
  const png = readFileSync(new URL("../../../public/astralbeam-logo-light.png", import.meta.url))
  try {
    await configure.open()
    await configure.signIn(operatorKey)
    await configure.setValue("s3_endpoint", endpoint)
    await configure.save()
    const currentSession = (await (await page.request.get("/api/auth/get-session")).json()) as {
      user: { id: string }
    }
    const organizations = (await (
      await page.request.get("/api/auth/organization/list")
    ).json()) as { id: string; slug: string }[]
    const organizationId = organizations.find(
      (organization) => organization.slug === baseline.organizationSlug,
    )!.id
    await pool.query("update member set avatar_file_id = null where user_id = $1", [
      currentSession.user.id,
    ])
    await pool.query("update organization set logo = null, logo_file_id = null where id = $1", [
      organizationId,
    ])
    await page.goto(`/${baseline.organizationSlug}`)
    await expect(shell.organizationSwitcher(baseline.organizationName)).toBeVisible()
    await userSettings.openAccount()
    await expect(page.getByRole("button", { name: "Change avatar", exact: true })).toHaveCount(0)
    await page.goto(`/${baseline.organizationSlug}/members`)
    await expect(members.avatarImage()).toHaveCount(0)
    await members.uploadAvatar(png)
    await expect(members.avatarImage()).toBeVisible()
    const avatarUrl = await members.avatarImage().getAttribute("src")
    expect(avatarUrl).toContain(`/api/files/organizations/${organizationId}/avatars/`)
    const redirect = await page.request.get(avatarUrl!, { maxRedirects: 0 })
    expect(redirect.status()).toBe(302)
    expect(redirect.headers()["cache-control"]).toBe("private, no-store")
    const signed = new URL(redirect.headers().location!)
    const expiresIn = Number(signed.searchParams.get("X-Amz-Expires"))
    expect(expiresIn).toBeGreaterThan(0)
    expect(expiresIn).toBeLessThanOrEqual(60)
    expect(signed.searchParams.has("X-Amz-Signature")).toBe(true)
    const avatar = await page.request.get(avatarUrl!)
    expect(avatar.status()).toBe(200)
    expect(avatar.headers()["cache-control"]).toBe("private, no-store")
    await page.reload()
    await expect(members.avatarImage()).toHaveAttribute("src", avatarUrl!)
    await captureMilestone(page, "stored-avatar-after-reload")
    storageFixture.corrupt = true
    const failedLogo = await page.request.post("/api/auth/organization/create", {
      headers: { origin: platformUrl },
      data: {
        name: "Organization with unavailable logo",
        slug: `logo-failure-${crypto.randomUUID()}`,
        logo: `data:image/png;base64,${png.toString("base64")}`,
      },
    })
    storageFixture.corrupt = false
    expect(failedLogo.status()).toBe(200)
    expect(await failedLogo.json()).toMatchObject({ logo: null, logoFileId: null })
    const otherResponse = await page.request.post("/api/auth/organization/create", {
      headers: { origin: platformUrl },
      data: {
        name: "Second avatar Organization",
        slug: `avatar-second-${crypto.randomUUID()}`,
        logo: `data:image/png;base64,${png.toString("base64")}`,
      },
    })
    expect(otherResponse.status()).toBe(200)
    const otherOrganization = (await otherResponse.json()) as {
      id: string
      slug: string
      logo: null
      logoFileId: string
    }
    expect(otherOrganization.logo).toBeNull()
    expect(
      await (
        await page.request.get(logoFileUrl(otherOrganization.id, otherOrganization.logoFileId))
      ).body(),
    ).toEqual(png)
    await page.goto(`/${otherOrganization.slug}/members`)
    await members.uploadAvatar(png)
    const secondAvatarUrl = await members.avatarImage().getAttribute("src")
    expect(secondAvatarUrl).toContain(`/organizations/${otherOrganization.id}/avatars/`)
    expect(secondAvatarUrl).not.toBe(avatarUrl)
    await members.removeAvatar()
    await page.goto(`/${baseline.organizationSlug}/members`)
    await expect(members.avatarImage()).toHaveAttribute("src", avatarUrl!)
    expect(
      (await page.request.get(avatarUrl!.replace(organizationId, otherOrganization.id))).status(),
    ).toBe(404)
    const inline = await page.request.post("/api/auth/update-user", {
      headers: { origin: platformUrl },
      data: { image: `data:image/png;base64,${png.toString("base64")}` },
    })
    expect(inline.status()).toBe(400)
    const sessionResponse = await page.request.get("/api/auth/get-session")
    const session = (await sessionResponse.json()) as {
      session: { activeOrganizationId: string | null }
      user: { image: string }
    }
    expect(session.user.image).toBeNull()
    expect(session.user).not.toHaveProperty("avatarFileId")
    const logoResponse = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: {
        organizationId,
        data: { logo: `data:image/png;base64,${png.toString("base64")}` },
      },
    })
    expect(logoResponse.status()).toBe(200)
    const logo = (await logoResponse.json()) as { logo: null; logoFileId: string }
    expect(logo.logo).toBeNull()
    const logoUrl = logoFileUrl(organizationId, logo.logoFileId)
    expect(await (await page.request.get(logoUrl)).body()).toEqual(png)
    const failedReplacement = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: { organizationId, data: { logo: "data:image/png;base64,aGVsbG8=" } },
    })
    expect(failedReplacement.status()).toBe(400)
    const saved = await pool.query("select logo, logo_file_id from organization where id = $1", [
      organizationId,
    ])
    expect(saved.rows[0]).toEqual({ logo: null, logo_file_id: logo.logoFileId })
    await page.goto(`/${baseline.organizationSlug}`)
    await expect(
      shell.organizationSwitcher(baseline.organizationName).locator("img"),
    ).toHaveAttribute("src", logoUrl)
    await captureMilestone(page, "stored-logo-after-reload")
    await page.goto(`/${baseline.organizationSlug}/members`)
    const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    try {
      for (const url of [avatarUrl!, logoUrl]) {
        const denied = await signedOut.request.get(new URL(url, platformUrl).href)
        expect(denied.status()).toBe(401)
      }
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
      const denied = await colleague.request.get(new URL(avatarUrl!, platformUrl).href)
      expect(denied.status()).toBe(404)
      const member = await pool.query<{ id: string }>(
        "insert into member (organization_id, user_id, role) values ($1, $2, 'viewer') returning id",
        [organizationId, colleagueId],
      )
      expect((await colleague.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
        200,
      )
      expect((await colleague.request.get(new URL(logoUrl, platformUrl).href)).status()).toBe(200)
      await colleaguePage.goto(`/${baseline.organizationSlug}/members`)
      await membersPage(colleaguePage).uploadAvatar(png)
      const avatar = await pool.query<{ avatar_file_id: string }>(
        "select avatar_file_id from member where id = $1",
        [member.rows[0]!.id],
      )
      const removed = await page.request.post("/api/auth/organization/remove-member", {
        headers: { origin: platformUrl },
        data: { organizationId, memberIdOrEmail: member.rows[0]!.id },
      })
      expect(removed.status()).toBe(200)
      const retired = await pool.query<{ status: string }>(
        "select status from file_object where organization_id = $1 and id = $2",
        [organizationId, avatar.rows[0]!.avatar_file_id],
      )
      expect(retired.rows[0]!.status).toBe("purging")
      expect((await colleague.request.get(new URL(avatarUrl!, platformUrl).href)).status()).toBe(
        404,
      )
      expect((await colleague.request.get(new URL(logoUrl, platformUrl).href)).status()).toBe(404)
    } finally {
      await colleague.close()
      await pool.query('delete from "user" where id = $1', [colleagueId])
    }
    const clearedLogo = await page.request.post("/api/auth/organization/update", {
      headers: { origin: platformUrl },
      data: { organizationId, data: { logo: null } },
    })
    expect(clearedLogo.status()).toBe(200)
    await members.removeAvatar()
    expect((await page.request.get(avatarUrl!)).status()).toBe(404)
  } finally {
    await stopBrowserStorageFixture(server)
    await pool.end()
  }
})
