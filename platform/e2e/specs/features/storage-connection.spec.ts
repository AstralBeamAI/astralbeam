import { once } from "node:events"
import { createServer } from "node:http"

import { captureMilestone } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { operatorKey } from "../../worktree.ts"

test("the operator tests unsaved storage settings and sees safe verification failures", async ({
  page,
  configure,
}) => {
  const objects = new Map<string, Uint8Array>()
  let corrupt = false
  const server = createServer((request, response) => {
    const respond = async () => {
      const key = new URL(request.url!, "http://localhost").pathname
      if (!key.startsWith("/storage/v1/s3/")) {
        response.writeHead(404).end()
        return
      }
      if (request.method === "PUT") {
        const chunks: Uint8Array[] = []
        for await (const chunk of request) chunks.push(chunk as Uint8Array)
        objects.set(key, Buffer.concat(chunks))
        response.writeHead(200, { ETag: '"fixture"' }).end()
      } else if (request.method === "DELETE") {
        objects.delete(key)
        response.writeHead(204).end()
      } else {
        const bytes = objects.get(key)
        if (!bytes) {
          response.writeHead(404).end()
          return
        }
        response.writeHead(200, { "Content-Length": bytes.length })
        response.end(
          request.method === "HEAD" ? undefined : corrupt ? new Uint8Array(bytes.length) : bytes,
        )
      }
    }
    void respond().catch(() => response.writeHead(500).end())
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No storage fixture address")
  try {
    await configure.open()
    await configure.signIn(operatorKey)
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
    await configure.setValue("s3_endpoint", `http://127.0.0.1:${address.port}/storage/v1/s3`)
    await configure.field("s3_path_style").click()
    await page.getByRole("option", { name: "Path style", exact: true }).click()
    await button.click()
    await expect(page.getByText("Storage connection succeeded", { exact: true })).toBeVisible()
    expect(objects.size).toBe(0)
    const storageGroup = page.locator('[data-slot="card"]').filter({ hasText: "File storage" })
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
    corrupt = true
    await button.click()
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeVisible()
    expect(objects.size).toBe(0)
    await configure.setValue("s3_bucket", "another-unsaved-bucket")
    await expect(page.getByText("Storage connection failed", { exact: true })).toBeHidden()
    await page.reload()
    await expect(configure.field("s3_bucket")).toHaveValue("e2e-files")
    await expect(configure.field("s3_access_key_id")).toHaveValue("")
    await expect(configure.field("s3_secret_access_key")).toHaveValue("")
    await captureMilestone(page, "storage-secrets-masked")
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
