import { startBrowserStorageFixture, stopBrowserStorageFixture } from "@e2e/object-storage.ts"

import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { operatorKey } from "@e2e/worktree.ts"

test("the operator changes configured storage after a manual migration warning", async ({
  page,
  configure,
}) => {
  await configure.open()
  await configure.signIn(operatorKey)
  const warning = page.getByText("Existing files must be migrated manually", { exact: true })
  await expect(warning).toBeHidden()
  await expect(configure.field("s3_bucket")).toHaveValue("e2e-files")
  await configure.setValue("s3_bucket", "replacement-files")
  await expect(warning).toBeVisible()
  await captureMilestone(page, "storage-manual-migration-warning")
  await configure.save()
  await expect(warning).toBeHidden()
  await page.reload()
  await configure.openSection("File storage")
  await expect(configure.field("s3_bucket")).toHaveValue("replacement-files")
  await captureMilestone(page, "storage-destination-saved")
  await configure.setValue("s3_bucket", "e2e-files")
  await configure.save()
})

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
    await configure.openSection("File storage")
    const button = page.getByRole("button", { name: "Test storage", exact: true })
    await expect(button).toBeDisabled()
    await configure.setValue("s3_access_key_id", "fixture-key")
    await configure.setValue("s3_secret_access_key", "fixture-secret")
    await page.getByRole("button", { name: "AWS S3 (us-east-1)", exact: true }).click()
    await expect(configure.field("s3_endpoint")).toHaveValue("https://s3.us-east-1.amazonaws.com")
    await expect(configure.field("s3_region")).toHaveValue("us-east-1")
    await expect(configure.field("s3_path_style")).toContainText("Virtual host")
    await page.getByRole("button", { name: "Cloudflare R2", exact: true }).click()
    await expect(configure.field("s3_endpoint")).toHaveValue(
      "https://<account-id>.r2.cloudflarestorage.com",
    )
    await expect(configure.field("s3_region")).toHaveValue("auto")
    await expect(button).toBeDisabled()
    await page.getByRole("button", { name: "Local RustFS / MinIO", exact: true }).click()
    await expect(configure.field("s3_endpoint")).toHaveValue("http://127.0.0.1:9000")
    await expect(configure.field("s3_region")).toHaveValue("us-east-1")
    await expect(configure.field("s3_path_style")).toContainText("Path style")
    await expect(configure.field("s3_bucket")).toHaveValue("e2e-files")
    await expect(configure.field("s3_access_key_id")).toHaveValue("fixture-key")
    await expect(configure.field("s3_secret_access_key")).toHaveValue("fixture-secret")
    for (const invalid of ["ftp://example.test", "http://s3.example.test"]) {
      await configure.setValue("s3_endpoint", invalid)
      await expect(button).toBeDisabled()
    }
    await configure.setValue("s3_endpoint", endpoint)
    await configure.field("s3_path_style").click()
    await page.getByRole("option", { name: "Path style", exact: true }).click()
    await button.click()
    await expect(page.getByText("Storage connection succeeded", { exact: true })).toBeVisible()
    expect(storageFixture.objects.size).toBe(0)
    const storageGroup = configure.section("File storage")
    await storageGroup.getByRole("button", { name: "File storage", exact: true }).click()
    await expect(page.getByText("Storage connection succeeded", { exact: true })).toBeHidden()
    await configure.openSection("File storage")
    await expect(page.getByText("Storage connection succeeded", { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 1400 })
    await storageGroup.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -80))
    await storageGroup.screenshot({
      path: test.info().outputPath("storage-connection-success.png"),
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await storageGroup.scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -80))
    await storageGroup.screenshot({ path: test.info().outputPath("storage-presets-mobile.png") })
    storageFixture.corrupt = true
    await button.click()
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeVisible()
    expect(storageFixture.objects.size).toBe(0)
    await configure.setValue("s3_bucket", "another-unsaved-bucket")
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeHidden()
    await page.reload()
    await configure.openSection("File storage")
    await expect(configure.field("s3_bucket")).toHaveValue("e2e-files")
    await expect(configure.field("s3_access_key_id")).toHaveValue("")
    await expect(configure.field("s3_secret_access_key")).toHaveValue("")
    await captureMilestone(page, "storage-secrets-masked")
  } finally {
    await stopBrowserStorageFixture(server)
  }
})
