import { describe, expect, test } from "vitest"

import { getGravatarAvatarUrl } from "./utils.ts"

describe("Gravatar avatar URLs", () => {
  test("normalizes and hashes email addresses with SHA-256", async () => {
    expect(await getGravatarAvatarUrl(" MyEmailAddress@example.com ")).toBe(
      "https://gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?d=404&r=g&s=128",
    )
  })

  test("omits the fallback when the email is empty", async () => {
    expect(await getGravatarAvatarUrl("  ")).toBeUndefined()
  })
})
