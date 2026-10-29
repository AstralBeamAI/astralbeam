import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { expect, test } from "@e2e/fixtures.ts"

test("organization logo changes persist and its required domain cannot be edited", async ({
  page,
  shell,
  organizationDialog,
  organizationSettings,
}) => {
  const initial = SEED_ORGANIZATIONS[0]
  const slug = `logo-${Date.now()}`
  await page.goto(`/${initial.slug}`)
  await shell.openCreateOrganization(initial.name)
  await organizationDialog.create("Logo settings", slug)
  await shell.openSection("Settings", "Organization settings")
  await expect(organizationSettings.domain).toHaveValue("example.com")
  await organizationSettings.expectDomainProtected()

  await organizationSettings.uploadLogo()
  await page.reload()
  await expect(organizationSettings.logo).toBeVisible()

  await organizationSettings.removeLogo()
  await page.reload()
  await expect(organizationSettings.logo).toBeHidden()
  await organizationSettings.refreshLogo()
})
