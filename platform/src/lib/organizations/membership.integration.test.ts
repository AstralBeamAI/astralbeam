import { createHmac } from "node:crypto"
import { and, eq, inArray } from "drizzle-orm"
import { Effect, Layer, ManagedRuntime } from "effect"
import { afterAll, describe, expect, test } from "@effect/vitest"
import { Database, getAuthDatabase } from "@/db/database"
import { user, session, member, organization, invitation } from "@/db/schema"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { Mailer } from "@/lib/email/email.server"
import { Organizations } from "./organizations.server"

const membershipDatabaseUrl = process.env.DATABASE_URL
const membershipConfigured =
  membershipDatabaseUrl && membershipDatabaseUrl !== "postgres://test:test@127.0.0.1:5432/test"
if (
  membershipConfigured &&
  (new URL(membershipDatabaseUrl).hostname !== "127.0.0.1" ||
    !new URL(membershipDatabaseUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")
const membershipOrigin = "https://membership.example"
const membershipSecret = "membership-test-signing-secret-0123456789"
const membershipConfig = Layer.succeed(Config, {
  snapshot: Effect.succeed({
    generation: 1,
    values: {
      app_base_url: membershipOrigin,
      better_auth_secret: membershipSecret,
      turnstile_secret_key: "dummy-turnstile",
    },
  }),
  setupState: Effect.succeed({ setupComplete: true }),
} as unknown as typeof Config.Service)
const membershipAuth = Auth.layerNoDeps.pipe(
  Layer.provide([membershipConfig, Layer.succeed(Mailer, {} as typeof Mailer.Service)]),
)
const membershipLayer = Layer.mergeAll(
  Database.layer,
  membershipAuth,
  Organizations.layerNoDeps.pipe(Layer.provide([Database.layer, membershipAuth, membershipConfig])),
)

describe.skipIf(!membershipConfigured)("membership acceptance and revocation", () => {
  const runtime = ManagedRuntime.make(membershipLayer)
  const organizationIds: string[] = []
  const userIds: string[] = []
  afterAll(async () => {
    const db = getAuthDatabase()
    if (organizationIds.length)
      await db.delete(organization).where(inArray(organization.id, organizationIds))
    if (userIds.length) await db.delete(user).where(inArray(user.id, userIds))
    await runtime.dispose()
    const { disposeAppRuntimes } = await import("@/lib/runtime/runtime.server")
    await disposeAppRuntimes()
  })
  function headers(token: string) {
    const signature = createHmac("sha256", membershipSecret).update(token).digest("base64")
    return new Headers({
      cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
      origin: membershipOrigin,
      "content-type": "application/json",
    })
  }
  test("concurrent invitations create one membership and removal denies fresh access", async () => {
    const db = getAuthDatabase()
    const people = await db
      .insert(user)
      .values(
        ["owner", "invitee"].map((name) => ({
          name,
          email: `${name}-${crypto.randomUUID()}@example.test`,
          emailVerified: true,
        })),
      )
      .returning()
    userIds.push(...people.map(({ id }) => id))
    const [owner, invitee] = people
    const orgs = await db
      .insert(organization)
      .values(
        ["membership", "other"].map((name) => ({ name, slug: `${name}-${crypto.randomUUID()}` })),
      )
      .returning()
    organizationIds.push(...orgs.map(({ id }) => id))
    const [org, other] = orgs
    await db.insert(member).values([
      { organizationId: org!.id, userId: owner!.id, role: "owner" },
      { organizationId: other!.id, userId: invitee!.id, role: "viewer" },
    ])
    const ownerToken = crypto.randomUUID()
    const inviteeToken = crypto.randomUUID()
    await db.insert(session).values([
      { userId: owner!.id, token: ownerToken, expiresAt: new Date(Date.now() + 3_600_000) },
      { userId: invitee!.id, token: inviteeToken, expiresAt: new Date(Date.now() + 3_600_000) },
    ])
    const invitations = await db
      .insert(invitation)
      .values(
        [1, 2].map(() => ({
          organizationId: org!.id,
          inviterId: owner!.id,
          email: invitee!.email,
          role: "viewer",
          expiresAt: new Date(Date.now() + 3_600_000),
        })),
      )
      .returning()
    const auth = await runtime.runPromise(Effect.flatMap(Auth, (service) => service.instance))
    const call = (path: string, token: string, body: unknown) =>
      auth.handler(
        new Request(`${membershipOrigin}/api/auth/organization/${path}`, {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify(body),
        }),
      )
    const accepted = await Promise.all(
      invitations.map((row) => call("accept-invitation", inviteeToken, { invitationId: row.id })),
    )
    expect(accepted.filter((response) => response.status === 200)).toHaveLength(1)
    expect(accepted.filter((response) => response.status !== 200)).toHaveLength(1)
    const retry = await call("accept-invitation", inviteeToken, {
      invitationId: invitations[accepted.findIndex((response) => response.status !== 200)]!.id,
    })
    expect(retry.status).toBe(400)
    await expect(retry.json()).resolves.toMatchObject({
      code: "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION",
    })
    const memberships = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, org!.id), eq(member.userId, invitee!.id)))
    expect(memberships).toHaveLength(1)
    expect(memberships[0]!.role).toBe("viewer")
    const access = (slug: string) =>
      runtime.runPromise(
        Effect.flatMap(Organizations, (service) =>
          service.access({ organizationSlug: slug, headers: headers(inviteeToken) }),
        ),
      )
    await expect(access(org!.slug)).resolves.toMatchObject({ role: "viewer" })
    expect(
      (
        await call("remove-member", ownerToken, {
          organizationId: org!.id,
          memberIdOrEmail: memberships[0]!.id,
        })
      ).status,
    ).toBe(200)
    await expect(access(org!.slug)).rejects.toMatchObject({ _tag: "OrganizationNotFound" })
    await expect(access(other!.slug)).resolves.toMatchObject({ role: "viewer" })
    const [ownerMember] = await db
      .select()
      .from(member)
      .where(and(eq(member.organizationId, org!.id), eq(member.userId, owner!.id)))
    expect(
      (
        await call("remove-member", ownerToken, {
          organizationId: org!.id,
          memberIdOrEmail: ownerMember!.id,
        })
      ).status,
    ).toBe(400)
  })
})
