import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"

import { Database, type EffectDatabase } from "@/db/database"
import { Auth, type AuthSession } from "@/lib/auth/auth.server"
import { Config, type SetupState } from "@/lib/config/config"
import { Organizations } from "./organizations.server.ts"

const MEMBERSHIP = {
  organizationId: "01990a5d-0000-7000-8000-000000000011",
  organizationSlug: "acme",
  organizationName: "Acme Inc",
  role: "owner",
}

function accessLayer(state: {
  session: { user: { id: string } } | null
  membership: typeof MEMBERSHIP | null
  sessionReads: number
  membershipReads: string[]
}) {
  const auth = Layer.succeed(Auth, {
    getSession: () =>
      Effect.sync(() => {
        state.sessionReads += 1
        return state.session as AuthSession | null
      }),
  } as unknown as Auth["Service"])
  const config = Layer.succeed(Config, {
    setupState: Effect.succeed({ setupComplete: true } as SetupState),
  } as unknown as Config["Service"])
  const read = Effect.sync(() => (state.membership ? [state.membership] : []))
  const chain = {
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => read,
  }
  const database = Layer.succeed(Database, {
    select: () => ({
      from: () => {
        state.membershipReads.push(state.session?.user.id ?? "")
        return chain
      },
    }),
  } as unknown as EffectDatabase)
  return Organizations.layerNoDeps.pipe(Layer.provide(Layer.mergeAll(auth, config, database)))
}

function freshState() {
  return {
    session: { user: { id: "user-a" } } as { user: { id: string } } | null,
    membership: MEMBERSHIP as typeof MEMBERSHIP | null,
    sessionReads: 0,
    membershipReads: [] as string[],
  }
}

describe("organization access", () => {
  it.effect("derives the organization and its permissions from the slug and the session", () => {
    const state = freshState()
    return Effect.gen(function* () {
      const organizations = yield* Organizations
      const access = yield* organizations.access({
        headers: new Headers(),
        organizationSlug: "acme",
        permissions: { organizationConfiguration: ["update"] },
      })
      assert.strictEqual(access.organizationId, MEMBERSHIP.organizationId)
      assert.isTrue(access.permissions.updateConfiguration)
      assert.deepStrictEqual(state.membershipReads, ["user-a"])
    }).pipe(Effect.provide(accessLayer(state)))
  })

  it.effect("denies a missing session, a non-member, and an insufficient role", () => {
    const state = freshState()
    return Effect.gen(function* () {
      const organizations = yield* Organizations
      const access = (permissions?: { organizationConfiguration: ["read"] }) =>
        Effect.flip(
          organizations.access({ headers: new Headers(), organizationSlug: "acme", permissions }),
        )
      state.membership = { ...MEMBERSHIP, role: "viewer" }
      assert.strictEqual(
        (yield* access({ organizationConfiguration: ["read"] }))._tag,
        "OrganizationAccessDenied",
      )
      state.membership = null
      assert.strictEqual((yield* access())._tag, "OrganizationNotFound")
      state.session = null
      assert.strictEqual((yield* access())._tag, "SignInRequired")
    }).pipe(Effect.provide(accessLayer(state)))
  })

  it.effect("reads the session and membership once per request, checking each permission", () => {
    const state = freshState()
    state.membership = { ...MEMBERSHIP, role: "viewer" }
    return Effect.gen(function* () {
      const organizations = yield* Organizations
      const headers = new Headers()
      yield* organizations.access({ headers, organizationSlug: "acme" })
      const denied = yield* Effect.flip(
        organizations.access({
          headers,
          organizationSlug: "acme",
          permissions: { apiKey: ["read"] },
        }),
      )
      assert.strictEqual(denied._tag, "OrganizationAccessDenied")
      assert.strictEqual(state.sessionReads, 1)
      assert.strictEqual(state.membershipReads.length, 1)

      yield* organizations.access({ headers: new Headers(), organizationSlug: "acme" })
      assert.strictEqual(state.membershipReads.length, 2)
    }).pipe(Effect.provide(accessLayer(state)))
  })
})
