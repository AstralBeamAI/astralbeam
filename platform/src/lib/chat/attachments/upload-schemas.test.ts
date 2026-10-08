import { Schema } from "effect"
import { expect, test } from "vitest"
import { UploadInputSchema } from "./upload-schemas"

test("upload filenames reject PostgreSQL NUL input before persistence", () => {
  const input = {
    filename: "résumé.txt",
    contentType: "text/plain",
    byteSize: 1,
    sha256: "0".repeat(64),
  }
  expect(Schema.is(UploadInputSchema)(input)).toBe(true)
  expect(Schema.is(UploadInputSchema)({ ...input, filename: "bad\0name" })).toBe(false)
})
