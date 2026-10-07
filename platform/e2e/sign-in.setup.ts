import { existsSync } from "node:fs"

import { expect, test } from "@playwright/test"

import { SEED_PASSWORD, SEED_USERS } from "../scripts/seed/fixtures.ts"
import { seededStatePath } from "./baseline.ts"
import { authPage } from "./pages/auth-page.ts"
import { platformUrl } from "./worktree.ts"

/**
 * Signs in as the seeded owner once and saves the session, so `specs/seeded` start signed in and
 * their videos show only the flow. A saved session the server still accepts skips this.
 */
test("sign in as the seeded owner", async ({ browser, page }) => {
  if (existsSync(seededStatePath)) {
    const saved = await browser.newContext({ storageState: seededStatePath })
    const session = await saved.request.get(`${platformUrl}/api/auth/get-session`)
    const valid = session.ok() && (await session.json()) !== null
    await saved.close()
    if (valid) return
  }
  const auth = authPage(page)
  await auth.open("sign-in")
  await auth.signIn(SEED_USERS[0].email, SEED_PASSWORD)
  await expect(
    page,
    "Sign-in failed. Run `deno task db-seed` from `platform` against this server's database.",
  ).not.toHaveURL(/\/auth\//, { timeout: 30_000 })
  await page.context().storageState({ path: seededStatePath })
})
