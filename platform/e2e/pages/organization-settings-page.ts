import { expect, type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"

import { expectToast } from "../dialogs.ts"

/** `/:orgSlug/settings`. Changing the slug moves every organization URL, including this one. */
export function organizationSettingsPage(page: Page) {
  return {
    domain: page.getByLabel("Domain", { exact: true }),
    logo: page.locator("form img"),

    async uploadLogo(): Promise<void> {
      const chooser = page.waitForEvent("filechooser")
      await page.getByRole("button", { name: "Change organization logo", exact: true }).click()
      await (
        await chooser
      ).setFiles(fileURLToPath(new URL("../../public/astralbeam-logo-light.png", import.meta.url)))
      await expectToast(page, "Organization logo uploaded")
    },

    async removeLogo(): Promise<void> {
      await page.getByRole("button", { name: "Change logo", exact: true }).click()
      await page.getByRole("menuitem", { name: "Remove logo", exact: true }).click()
      await expectToast(page, "Organization logo removed")
    },

    async refreshLogo(): Promise<void> {
      await page.getByRole("button", { name: "Change logo", exact: true }).click()
      await page.getByRole("menuitem", { name: "Refresh logo from domain", exact: true }).click()
      await expectToast(page, "Logo refresh requested")
    },

    async expectDomainProtected(): Promise<void> {
      const before = await this.domain.inputValue()
      const response = await page.request.get("/api/auth/organization/get-full-organization")
      expect(response.ok()).toBe(true)
      const current = (await response.json()) as { id: string }
      const update = await page.request.post("/api/auth/organization/update", {
        headers: { origin: new URL(page.url()).origin },
        data: {
          organizationId: current.id,
          data: { domain: "edited.example" },
        },
      })
      expect(update.ok()).toBe(true)
      const after = await page.request.get("/api/auth/organization/get-full-organization")
      expect(((await after.json()) as { domain: string }).domain).toBe(before)
    },

    async rename(name: string): Promise<void> {
      await page.locator("#organization-name").fill(name)
      await page.getByRole("button", { name: "Save changes" }).click()
      await expectToast(page, "Organization saved")
    },

    async changeSlug(slug: string): Promise<void> {
      await page.locator("#organization-slug").fill(slug)
      await page.getByRole("button", { name: "Save changes" }).click()
      await page.waitForURL(`**/${slug}/settings`)
    },
  }
}

export type OrganizationSettingsPage = ReturnType<typeof organizationSettingsPage>
