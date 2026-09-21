import { afterEach, expect, test, vi } from "vitest"
import * as Schema from "effect/Schema"

import { OwnerOnboardingInput } from "@/lib/dogfood/schema"
import { environmentConfigValues, validateConfigCompleteness } from "./registry.server"
import { updateGlobalConfig } from "./update.server"

afterEach(() => vi.unstubAllEnvs())

test("cross-organization dogfood credentials cannot complete setup", () => {
  const organizationId = "01990a5d-ac96-774b-b942-6b13c85384ca"
  const keyId = "01990a5d-ac96-774b-b942-6b13c85384c9"
  const credential = `key_${organizationId}_${keyId}_abo_${"A".repeat(64)}`
  expect(
    validateConfigCompleteness({ dogfood_organization_id: keyId, dogfood_api_key: credential }),
  )
    .toContainEqual({
      key: "dogfood_api_key",
      message: "Embedded assistant credential ownership is invalid",
    })
})

test.each([
  [".owner@example.com", false],
  ["owner..test@example.com", false],
  ["Owner+test@example.com", true],
])("onboarding accepts %s only when password reset can use it", (email, accepted) => {
  expect(Schema.is(OwnerOnboardingInput.fields.email)(email)).toBe(accepted)
})

test("dogfood values cannot be overridden or edited through generic configuration", async () => {
  for (const key of ["dogfood_organization_id", "dogfood_api_key", "dogfood_pending_setup"]) {
    vi.stubEnv(key.toUpperCase(), "attacker-value")
    expect(environmentConfigValues()).not.toHaveProperty(key)
    expect(await updateGlobalConfig([{ key, value: "attacker-value" }])).toMatchObject({
      ok: false,
    })
  }
})
