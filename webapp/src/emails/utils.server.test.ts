import process from "node:process"

import { expect, test } from "vitest"

import { sendEmail } from "./index.ts"

test("authentication tests cannot load a real email provider", async () => {
  const originalNodeEnv = process.env.NODE_ENV
  process.env.NODE_ENV = "production"

  try {
    await expect(
      sendEmail({
        to: "person@example.com",
        from: "sender@example.com",
        subject: "Test",
        html: "<p>Test</p>",
        provider: "resend",
      }),
    ).rejects.toThrow("Email delivery is disabled during tests")
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  }
})
