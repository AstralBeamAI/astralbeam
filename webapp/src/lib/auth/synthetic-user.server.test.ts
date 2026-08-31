import * as Schema from "effect/Schema"
import { describe, expect, test } from "vitest"

import { UuidV7Schema } from "@/lib/schemas"

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

    expect(Schema.is(UuidV7Schema)(user.id)).toBe(true)
  })
})
