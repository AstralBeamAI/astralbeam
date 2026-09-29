import { Schema } from "effect"
import { expect, test } from "vitest"

import { OwnerOnboardingInput } from "./schemas.ts"

// Better Auth mails the owner a password-reset link, so onboarding refuses what it would refuse.
test.each([
  [".owner@example.com", false],
  ["owner..test@example.com", false],
  ["Owner+test@example.com", true],
])("onboarding accepts %s only when password reset can use it", (email, accepted) => {
  expect(Schema.is(OwnerOnboardingInput.fields.email)(email)).toBe(accepted)
})
