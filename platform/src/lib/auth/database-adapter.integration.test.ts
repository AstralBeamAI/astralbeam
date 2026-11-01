import { betterAuth } from "better-auth/minimal"
import { organization as organizationPlugin } from "better-auth/plugins"
import { and, eq, like } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { account, member, organization, session, user } from "@/db/schema"
import { organizationAccessControl, organizationRoles } from "@/lib/organizations/access"
import { organizationRoleHooks } from "@/lib/organizations/hooks.server"
import { authDatabaseAdapter } from "./database-adapter.server.ts"

const configured = process.env.DATABASE_URL
const enabled = configured !== "postgres://test:test@127.0.0.1:5432/test"
if (
  enabled &&
  (!configured ||
    new URL(configured).hostname !== "127.0.0.1" ||
    !new URL(configured).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")

function createConstraintAuth() {
  return betterAuth({
    baseURL: "http://localhost:4500",
    secret: "auth-concurrency-test-secret-not-for-deployment",
    database: authDatabaseAdapter(),
    advanced: { database: { generateId: false } },
    emailAndPassword: { enabled: true },
    account: { accountLinking: { allowUnlinkingAll: false } },
    plugins: [
      organizationPlugin({
        ac: organizationAccessControl,
        roles: organizationRoles,
        organizationHooks: organizationRoleHooks,
        schema: {
          organization: {
            additionalFields: { domain: { type: "string", input: false, required: false } },
          },
        },
      }),
    ],
  })
}

describe.skipIf(!enabled)("authentication cross-row invariants", () => {
  const db = getAuthDatabase()
  let clients: ReturnType<typeof createConstraintAuth>[]
  let users: (typeof user.$inferSelect)[] = []
  let groups: (typeof organization.$inferSelect)[] = []
  let owners: (typeof member.$inferSelect)[]
  let headers: Headers[]
  let namespace: string
  const password = "AuthConcurrencyTestPassword-761"

  beforeEach(async () => {
    namespace = `auth-race-${crypto.randomUUID()}`
    clients = [createConstraintAuth(), createConstraintAuth()]
    const hash = await (await clients[0]!.$context).password.hash(password)
    users = await db
      .insert(user)
      .values(
        [0, 1].map((index) => ({
          name: `Concurrent ${index}`,
          email: `${namespace}-${index}@example.com`,
          emailVerified: true,
        })),
      )
      .returning()
    await db.insert(account).values(
      users.map(({ id }) => ({
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hash,
      })),
    )
    headers = await Promise.all(
      users.map(async (owner, index) => {
        const { headers: cookies } = await clients[index]!.api.signInEmail({
          body: { email: owner.email, password },
          returnHeaders: true,
        })
        return new Headers({
          cookie: cookies
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
        })
      }),
    )
    groups = await db
      .insert(organization)
      .values(
        [0, 1].map((index) => ({
          name: `Concurrent ${index}`,
          slug: `${namespace}-${index}`,
          domain: "example.com",
        })),
      )
      .returning()
    owners = await db
      .insert(member)
      .values(users.map(({ id }) => ({ organizationId: groups[0]!.id, userId: id, role: "owner" })))
      .returning()
  })
  afterEach(async () => {
    await db.delete(organization).where(like(organization.slug, `${namespace}-%`))
    await db.delete(user).where(like(user.email, `${namespace}-%`))
  })

  test("independent auth instances cannot unlink both remaining accounts", async () => {
    const linked = await db
      .insert(account)
      .values(
        ["google", "github"].map((providerId) => ({
          userId: users[0]!.id,
          accountId: crypto.randomUUID(),
          providerId,
        })),
      )
      .returning()
    await db
      .delete(account)
      .where(and(eq(account.userId, users[0]!.id), eq(account.providerId, "credential")))
    const results = await Promise.allSettled(
      clients.map((auth, index) =>
        auth.api.unlinkAccount({ headers: headers[0]!, body: { accountId: linked[index]!.id } }),
      ),
    )
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { body: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" } },
    })
    expect(await db.select().from(account).where(eq(account.userId, users[0]!.id))).toHaveLength(1)
    expect(await db.select().from(account).where(eq(account.userId, users[1]!.id))).toHaveLength(1)
  })

  test.each(["leave", "remove", "demote"] as const)(
    "concurrent owner %s preserves one owner",
    async (operation) => {
      const results = await Promise.allSettled(
        clients.map((auth, index) => {
          const input = { headers: headers[index]! }
          if (operation === "leave")
            return auth.api.leaveOrganization({ ...input, body: { organizationId: groups[0]!.id } })
          if (operation === "remove")
            return auth.api.removeMember({
              ...input,
              body: { organizationId: groups[0]!.id, memberIdOrEmail: owners[index]!.id },
            })
          return auth.api.updateMemberRole({
            ...input,
            body: { organizationId: groups[0]!.id, memberId: owners[index]!.id, role: "viewer" },
          })
        }),
      )
      expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1)
      expect(results.find(({ status }) => status === "rejected")).toMatchObject({
        reason: {
          body: {
            code:
              operation === "demote"
                ? "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER"
                : "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
          },
        },
      })
      expect(
        (await db.select().from(member).where(eq(member.organizationId, groups[0]!.id))).filter(
          ({ role }) => role.split(",").includes("owner"),
        ),
      ).toHaveLength(1)
    },
  )

  test("endpoint authority and fresh sessions are required before protected writes", async () => {
    const [linked] = await db
      .insert(account)
      .values({ userId: users[0]!.id, accountId: crypto.randomUUID(), providerId: "google" })
      .returning()
    await db
      .update(session)
      .set({ createdAt: new Date(0) })
      .where(eq(session.userId, users[0]!.id))
    await expect(
      clients[0]!.api.unlinkAccount({ headers: headers[0]!, body: { accountId: linked!.id } }),
    ).rejects.toMatchObject({ body: { code: "SESSION_NOT_FRESH" } })
    expect(await db.select().from(account).where(eq(account.userId, users[0]!.id))).toHaveLength(2)
    await db.update(member).set({ role: "viewer" }).where(eq(member.id, owners[1]!.id))
    await expect(
      clients[1]!.api.updateMemberRole({
        headers: headers[1]!,
        body: { organizationId: groups[0]!.id, memberId: owners[0]!.id, role: "viewer" },
      }),
    ).rejects.toMatchObject({ body: { code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_THIS_MEMBER" } })
    await expect(
      clients[1]!.api.removeMember({
        headers: headers[1]!,
        body: { organizationId: groups[0]!.id, memberIdOrEmail: owners[0]!.id },
      }),
    ).rejects.toMatchObject({
      body: { code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" },
    })
    expect((await db.select().from(member).where(eq(member.id, owners[0]!.id)))[0]!.role).toBe(
      "owner",
    )
  })

  test("rollback releases locks and bulk mutations cannot remove the last identities or owners", async () => {
    const options = clients[0]!.options
    const first = authDatabaseAdapter()(options)
    const second = authDatabaseAdapter()(options)
    const linked = await db
      .insert(account)
      .values({ userId: users[0]!.id, accountId: crypto.randomUUID(), providerId: "google" })
      .returning()
    const mutation = { model: "account", where: [{ field: "id", value: linked[0]!.id }] }
    await expect(
      first.transaction(async (transaction) => {
        await transaction.delete(mutation)
        throw new Error("Rollback fixture")
      }),
    ).rejects.toThrow("Rollback fixture")
    expect(
      await second.count({ model: "account", where: [{ field: "userId", value: users[0]!.id }] }),
    ).toBe(2)
    await second.delete(mutation)
    await expect(
      first.deleteMany({
        model: "account",
        where: [{ field: "userId", operator: "in", value: users.map(({ id }) => id) }],
      }),
    ).rejects.toMatchObject({ body: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" } })
    await expect(
      second.updateMany({
        model: "member",
        where: [{ field: "organizationId", value: groups[0]!.id }],
        update: { role: "viewer" },
      }),
    ).rejects.toMatchObject({
      body: { code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER" },
    })
    expect(
      await db.select().from(member).where(eq(member.organizationId, groups[0]!.id)),
    ).toHaveLength(2)
  })

  test("the last owner beyond the adapter's default page remains protected", async () => {
    const extra = await db
      .insert(user)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          name: "Viewer",
          email: `${namespace}-viewer-${index}@example.com`,
          emailVerified: true,
        })),
      )
      .returning()
    await db
      .insert(member)
      .values(
        extra.map(({ id }) => ({ organizationId: groups[1]!.id, userId: id, role: "viewer" })),
      )
    await db
      .insert(member)
      .values({ organizationId: groups[1]!.id, userId: users[0]!.id, role: "owner" })
    const adapter = authDatabaseAdapter()(clients[0]!.options)
    await expect(
      adapter.deleteMany({
        model: "member",
        where: [{ field: "organizationId", value: groups[1]!.id }],
      }),
    ).rejects.toMatchObject({
      body: { code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" },
    })
    expect(
      await adapter.count({
        model: "member",
        where: [{ field: "organizationId", value: groups[1]!.id }],
      }),
    ).toBe(102)
  })
})
