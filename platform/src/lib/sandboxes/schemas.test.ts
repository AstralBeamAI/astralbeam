import { it as effectIt } from "@effect/vitest"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { decodeProviderCredentials, decodeProviderOptions } from "./schemas.ts"
import { strictParseOptions, toValidationSchema } from "@/lib/schemas"
import { SaveSandboxProviderInputSchema } from "@/routes/_authenticated/$orgSlug/sandboxes/-lib/schemas"

describe("sandbox provider schemas", () => {
  it("reports all invalid request fields and rejects mismatched credentials without exposing them", async () => {
    const validator = toValidationSchema(SaveSandboxProviderInputSchema, strictParseOptions)
    const result = await validator["~standard"].validate({
      organizationSlug: "acme",
      name: "",
      providerType: "docker",
      options: { image: "" },
      credentials: { apiKey: "private-test-secret" },
      id: null,
      lockVersion: null,
    })
    expect(result.issues?.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([["name"], ["options", "image"], ["credentials", "apiKey"]]),
    )
    expect(JSON.stringify(result)).not.toContain("private-test-secret")
  })

  effectIt.effect("rejects provider-mismatched and unsafe stored values", () =>
    Effect.gen(function* () {
      const options = { target: "us", snapshot: "daytona-medium", apiKey: "leak" }
      yield* Effect.flip(decodeProviderOptions("daytona", options))
      yield* Effect.flip(decodeProviderCredentials("docker", { apiKey: "token" }))
    }),
  )
})
