import { afterEach, expect, test, vi } from "vitest"
import * as Schema from "effect/Schema"

import { OwnerOnboardingInput } from "@/lib/dogfood/schema"
import { environmentConfigValues } from "./registry.server"
import { updateGlobalConfig } from "./update.server"

afterEach(() => vi.unstubAllEnvs())

test.each([
  [".owner@example.com", false],
  ["owner..test@example.com", false],
  ["Owner+test@example.com", true],
])("onboarding accepts %s only when password reset can use it", (email, accepted) => {
  expect(Schema.is(OwnerOnboardingInput.fields.email)(email)).toBe(accepted)
})

test("dogfood values cannot be overridden or edited through generic configuration", async () => {
  for (const key of ["dogfood_organization_id", "dogfood_pending_setup"]) {
    vi.stubEnv(key.toUpperCase(), "attacker-value")
    expect(environmentConfigValues()).not.toHaveProperty(key)
    expect(await updateGlobalConfig([{ key, value: "attacker-value" }])).toMatchObject({
      ok: false,
    })
  }
})
