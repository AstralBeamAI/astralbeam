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
    await configure.setValue("s3_endpoint", "ftp://example.test")
    await expect(button).toBeDisabled()
    await configure.setValue("s3_endpoint", `http://127.0.0.1:${address.port}`)
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
