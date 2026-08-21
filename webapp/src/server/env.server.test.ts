import { describe, expect, it } from "vitest"

import { parseServerEnvironment } from "./env.server"

const validEnvironment = {
  BETTER_AUTH_SECRET: "development-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/astralbeam",
  GITHUB_CLIENT_ID: "github-client",
  GITHUB_CLIENT_SECRET: "github-secret",
  GOOGLE_CLIENT_ID: "google-client",
  GOOGLE_CLIENT_SECRET: "google-secret",
}

describe("parseServerEnvironment", () => {
  it("rejects short auth secrets", () => {
    expect(() => parseServerEnvironment({ ...validEnvironment, BETTER_AUTH_SECRET: "short" }))
      .toThrow()
  })

  it.each(["/auth", "ftp://example.com"])("rejects an unsafe auth URL: %s", (authUrl) => {
    expect(() => parseServerEnvironment({ ...validEnvironment, BETTER_AUTH_URL: authUrl }))
      .toThrow()
  })
})
