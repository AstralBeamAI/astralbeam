import { startBrowserStorageFixture, stopBrowserStorageFixture } from "../../object-storage.ts"

import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { operatorKey } from "../../worktree.ts"

test("the operator tests unsaved storage settings and sees safe verification failures", async ({
  page,
  configure,
}) => {
  const storageFixture = {
    objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
    corrupt: false,
  }
  const { server, endpoint } = await startBrowserStorageFixture(storageFixture)
  try {
    await configure.open()
    await configure.signIn(operatorKey)
    const button = page.getByRole("button", { name: "Test storage", exact: true })
    await expect(button).toBeDisabled()
    await configure.setValue("s3_access_key_id", "fixture-key")
    await configure.setValue("s3_secret_access_key", "fixture-secret")
    await configure.setValue("s3_endpoint", "ftp://example.test")
    await expect(button).toBeDisabled()
    await configure.setValue("s3_endpoint", endpoint)
    await configure.field("s3_path_style").click()
    await page.getByRole("option", { name: "Path style", exact: true }).click()
    await button.click()
    await expect(page.getByText("Storage connection succeeded", { exact: true })).toBeVisible()
    expect(storageFixture.objects.size).toBe(0)
    const storageGroup = page.locator('[data-slot="card"]').filter({ hasText: "File storage" })
    await page.setViewportSize({ width: 1280, height: 1400 })
    await storageGroup.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -80))
    await storageGroup.screenshot({
      path: test.info().outputPath("storage-connection-success.png"),
    })
    storageFixture.corrupt = true
    await button.click()
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeVisible()
    expect(storageFixture.objects.size).toBe(0)
    await configure.setValue("s3_bucket", "another-unsaved-bucket")
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeHidden()
    await page.reload()
    await expect(configure.field("s3_bucket")).toHaveValue("e2e-files")
    await expect(configure.field("s3_access_key_id")).toHaveValue("")
    await expect(configure.field("s3_secret_access_key")).toHaveValue("")
    await captureMilestone(page, "storage-secrets-masked")
  } finally {
    await stopBrowserStorageFixture(server)
  }
})
