import { expect, type Locator, type Page } from "@playwright/test"

import { waitForHydration } from "../hydration.ts"

export type SignUpDetails = { name: string; email: string; password: string }

/**
 * The unauthenticated views under `/auth/$path`. Selectors track `src/components/auth`, whose
 * fields keep stable ids while their visible labels come from Better Auth UI's localization.
 */
export function authPage(page: Page) {
  const submitButton = (name: RegExp) => page.getByRole("button", { name })

  /** Every credential form stays disabled until Turnstile hands the client its token. */
  const submitWhenReady = async (button: Locator) => {
    await expect(button).toBeEnabled({ timeout: 30_000 })
    await button.click()
  }

  return {
    async open(view: "sign-in" | "sign-up" | "verify-email"): Promise<void> {
      await page.goto(`/auth/${view}`)
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    },

    heading(): Locator {
      return page.getByRole("heading", { level: 1 })
    },

    /** Follows the prompt that switches between the sign-in and sign-up views. */
    async followPromptLink(name: RegExp): Promise<void> {
      await page.getByRole("link", { name }).click()
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name)
    },

    async signUp({ name, email, password }: SignUpDetails): Promise<void> {
      // The password fields are React-controlled, so a value typed before hydration is discarded.
      await waitForHydration(page.locator("#password"))
      await page.locator("#name").fill(name)
      await page.locator("#email").fill(email)
      await page.locator("#password").fill(password)
      await page.locator("#confirmPassword").fill(password)
      // Only rendered when a legal policy URL is configured.
      const acceptLegal = page.locator("#accept-legal")
      if (await acceptLegal.count() > 0) await acceptLegal.click()
      await submitWhenReady(submitButton(/^sign up$/i))
    },

    async signIn(email: string, password: string): Promise<void> {
      await waitForHydration(page.locator("#password"))
      await page.locator("#email").fill(email)
      await page.locator("#password").fill(password)
      await submitWhenReady(submitButton(/^sign in$/i))
    },

    /** Opens the link from the verification email, which also signs the new account in. */
    async completeEmailVerification(verificationLink: string): Promise<void> {
      await page.goto(verificationLink)
      await page.waitForURL((url) => !url.pathname.startsWith("/api/auth"))
    },
  }
}

export type AuthPage = ReturnType<typeof authPage>
