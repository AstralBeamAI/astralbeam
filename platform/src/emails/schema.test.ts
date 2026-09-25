import { expect, test } from "vitest"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"

import { EmailProviderConnectionInputSchema } from "./schema"

test("provider validation rejects excess settings without exposing credentials", async () => {
  const validator = toValidationSchema(EmailProviderConnectionInputSchema, strictParseOptions)
  const result = await validator["~standard"].validate({
    provider: "resend",
    settings: { resend_api_key: "private-test-key", unexpected: "private-extra-value" },
  })
  expect(result.issues?.length).toBeGreaterThan(0)
  expect(JSON.stringify(result.issues)).not.toContain("private-test-key")
  expect(JSON.stringify(result.issues)).not.toContain("private-extra-value")
})
