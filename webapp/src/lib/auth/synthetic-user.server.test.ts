import { describe, expect, test } from "vitest"

import { createSyntheticUser } from "./synthetic-user.server.ts"

describe("synthetic duplicate-signup users", () => {
  test("match the UUIDv7 shape of database-created users", () => {
    const user = createSyntheticUser({
      name: "Astral User",
      email: "person@example.com",
      emailVerified: false,
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })
})
