import { describe, expect, it } from "vitest"

import { suggestOrganizationNameFromEmail } from "./utils"

describe("suggestOrganizationNameFromEmail", () => {
  it.each([
    ["person@example.ai", "Example"],
    ["person@acme-labs.co.uk", "Acme Labs"],
    ["person@team.example.com", "Example"],
    ["person@gmail.com", ""],
    ["12345@users.noreply.github.com", ""],
    ["not-an-email", ""],
  ])("suggests an organization for %s", (email, expected) => {
    expect(suggestOrganizationNameFromEmail(email)).toBe(expected)
  })
})
