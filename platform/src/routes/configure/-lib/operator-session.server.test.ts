import { createHmac } from "node:crypto"

import { assert, describe, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { TestClock } from "effect/testing"
import { SignJWT } from "jose"

import { createOperatorSession, verifyOperatorSession } from "./operator-session.server"

const ROOT = new Uint8Array(32).fill(1)
const NOW = new Date("2026-08-27T00:00:00.000Z").getTime()

describe("operator session boundary", () => {
  it.effect("accepts only an untampered token during its absolute lifetime", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const token = yield* createOperatorSession(ROOT)
      assert.deepStrictEqual(
        yield* verifyOperatorSession(token, ROOT),
        Option.some({ expiresAt: new Date("2026-08-27T00:15:00.000Z") }),
      )

      const [header, payload, signature] = token.split(".")
      const tampered = `${header}.${payload}.${signature?.startsWith("a") ? "b" : "a"}${signature?.slice(1)}`
      assert.isTrue(Option.isNone(yield* verifyOperatorSession(tampered, ROOT)))

      yield* TestClock.adjust(15 * 60 * 1_000 + 1)
      assert.isTrue(Option.isNone(yield* verifyOperatorSession(token, ROOT)))
    }),
  )

  it.effect("rejects signed tokens with invalid operator claims", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const key = createHmac("sha256", ROOT)
        .update("configure-operator-session-signing-key:v1\0")
        .digest()
      const iat = Math.floor(NOW / 1_000)
      for (const invalid of [
        { sub: "user" },
        { iat: iat + 0.5, exp: iat + 900.5 },
        { exp: iat + 901 },
        { typ: "JWT" },
        { typ: "OPERATOR-SESSION+JWT" },
      ]) {
        const { typ = "operator-session+jwt", ...claims } = invalid
        const token = yield* Effect.promise(() =>
          new SignJWT({ sub: "operator", iat, exp: iat + 900, ...claims })
            .setProtectedHeader({ alg: "HS256", typ })
            .setIssuer("configure")
            .setAudience("configure")
            .setJti("test")
            .sign(key),
        )
        assert.isTrue(Option.isNone(yield* verifyOperatorSession(token, ROOT)))
      }
    }),
  )

  it.effect("expires when the active database encryption key changes", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW)
      const token = yield* createOperatorSession(ROOT)
      assert.isTrue(Option.isSome(yield* verifyOperatorSession(token, ROOT)))
      assert.isTrue(Option.isNone(yield* verifyOperatorSession(token, new Uint8Array(32).fill(2))))
    }),
  )
})
