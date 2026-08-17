import { describe, expect, test } from "vite-plus/test"

import { inferOrganizationName } from "./organization-name"

describe("inferOrganizationName", () => {
  test.each([
    ["founder@acme.com", "Acme"],
    ["founder@acme-labs.io", "Acme Labs"],
    ["founder@mail.acme.com", "Acme"],
    ["founder@acme.co.uk", "Acme"],
    ["founder@acme.com.au", "Acme"],
  ])("infers a readable name from %s", (email, expected) => {
    expect(inferOrganizationName(email)).toBe(expected)
  })

  test.each([
    "founder@gmail.com",
    "founder@outlook.com",
    "founder@proton.me",
    "123+founder@users.noreply.github.com",
    "invalid",
  ])("does not suggest an organization for %s", (email) => {
    expect(inferOrganizationName(email)).toBe("")
  })
})
