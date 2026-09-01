import process from "node:process"

import { expect, test } from "vitest"

import { sendEmail } from "./index.ts"
import { maskEmailAddressForLog } from "./utils.server.ts"

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

test("a logged recipient keeps its domain and reveals neither the local part nor its length", () => {
  expect(maskEmailAddressForLog("member@example.com")).toBe("m***r@example.com")
  expect(maskEmailAddressForLog("a.very.long.address@example.com")).toBe("a***s@example.com")
  // Short local parts drop the trailing character so two of them cannot be told apart.
  expect(maskEmailAddressForLog("ab@example.com")).toBe("a***@example.com")
  expect(maskEmailAddressForLog("abc@example.com")).toBe("a***@example.com")
  expect(maskEmailAddressForLog("not-an-address")).toBe("***")
  expect(maskEmailAddressForLog("@example.com")).toBe("***")
})
