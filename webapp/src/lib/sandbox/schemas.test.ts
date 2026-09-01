import { describe, expect, it } from "vitest"

import { decodeProviderCredentials, decodeProviderOptions } from "./schemas.ts"

describe("sandbox provider schemas", () => {
  it("rejects provider-mismatched and unsafe stored values", () => {
    expect(() =>
      decodeProviderOptions("daytona", {
        target: "us",
        snapshot: "daytona-medium",
        apiKey: "leak",
      })
    ).toThrow()
    expect(() => decodeProviderCredentials("docker", { apiKey: "token" })).toThrow()
  })
})
