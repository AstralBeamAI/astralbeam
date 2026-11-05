import { SEED_PASSWORD, SEED_USERS } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("last-used email hint remains visible after sign-out", async ({ page, auth, shell }) => {
  await page.goto("/auth/sign-out")
  await page.waitForURL(/\/auth\/sign-in/)
  await page.context().clearCookies({ name: "better-auth.last_used_login_method" })

  await auth.signIn(SEED_USERS[0].email, SEED_PASSWORD)
  await expect(page).not.toHaveURL(/\/auth\//)
  await shell.signOut()
  await expect(page.getByRole("button", { name: "Sign In Last used", exact: true })).toBeVisible()
})
