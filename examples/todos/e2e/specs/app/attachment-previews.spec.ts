import { Buffer } from "node:buffer"
import { readFileSync } from "node:fs"
import { expect, test } from "../../fixtures.ts"

test("stored image and text previews recover without uploading again, with cards for PDFs", async ({
  page,
  chat,
}) => {
  const files = (
    [
      [
        "logo.png",
        "image/png",
        readFileSync(
          new URL("../../../../../platform/public/astralbeam-logo-light.png", import.meta.url),
        ),
      ],
      ["note.txt", "text/plain", Buffer.from("Review attachment previews\n")],
      ["reference.pdf", "application/pdf", Buffer.from("%PDF-1.4")],
    ] as const
  ).map(([name, mimeType, buffer]) => ({ name, mimeType, buffer }))
  let uploads = 0
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/chat/files")
      uploads++
  })
  await chat.waitForReady()
  await chat.attach(files)
  for (const reload of [false, true]) {
    if (reload) await page.reload()
    await expect(chat.sendButton()).toBeEnabled()
    for (const name of ["logo.png", "note.txt"]) {
      await chat.attachmentCard(name).scrollIntoViewIfNeeded()
      const preview = chat.attachmentPreview(name)
      await expect
        .poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0)
    }
    await expect(chat.attachmentChip("reference.pdf")).toBeVisible()
    await expect(chat.attachmentPreview("reference.pdf")).toHaveCount(0)
    expect(uploads).toBe(files.length)
  }
  const stored = await page.evaluate(() => Object.values(localStorage).join(""))
  expect(stored).toContain('"fileId"')
  for (const { buffer } of files) expect(stored).not.toContain(buffer.toString("base64"))
})
