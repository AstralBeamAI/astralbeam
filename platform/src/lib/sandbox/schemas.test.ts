import { describe, expect, it } from "vitest"

import { decodeProviderCredentials, decodeProviderOptions } from "./schemas.ts"
import { toStrictStandardSchema } from "@/lib/schemas"
import { SaveSandboxProviderInputSchema } from "@/routes/_authenticated/$orgSlug/sandboxes/-lib/schemas"

describe("sandbox provider schemas", () => {
  it("reports all invalid request fields and rejects mismatched credentials without exposing them", async () => {
    const validator = toStrictStandardSchema(SaveSandboxProviderInputSchema)
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

  it("rejects provider-mismatched and unsafe stored values", () => {
    expect(() =>
      decodeProviderOptions("daytona", {
        target: "us",
        snapshot: "daytona-medium",
        apiKey: "leak",
      }),
    ).toThrow()
    expect(() => decodeProviderCredentials("docker", { apiKey: "token" })).toThrow()
  })
})
