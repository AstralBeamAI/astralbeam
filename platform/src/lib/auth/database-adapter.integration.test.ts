import { betterAuth } from "better-auth/minimal"
import { organization as organizationPlugin } from "better-auth/plugins"
import { and, eq, like } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

import { getAuthDatabase } from "@/db/database"
import { account, member, organization, user } from "@/db/schema"
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
  let users: { id: string }[] = []
  let group: typeof organization.$inferSelect
  let owners: (typeof member.$inferSelect)[]
  let headers: Headers[]
  let namespace: string
  const password = "AuthConcurrencyTestPassword-761"

  beforeEach(async () => {
    namespace = `auth-race-${crypto.randomUUID()}`
    clients = [createConstraintAuth(), createConstraintAuth()]
    const registrations = await Promise.all(
      clients.map((auth, index) =>
        auth.api.signUpEmail({
          body: { name: "Concurrent", email: `${namespace}-${index}@example.com`, password },
          returnHeaders: true,
        }),
      ),
    )
    users = registrations.map(({ response }) => response.user)
    headers = registrations.map(
      ({ headers }) =>
        new Headers({
          cookie: headers
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
        }),
    )
    const [created] = await db
      .insert(organization)
      .values({ name: "Concurrent", slug: namespace, domain: "example.com" })
      .returning()
    group = created!
    owners = await db
      .insert(member)
      .values(users.map(({ id }) => ({ organizationId: group.id, userId: id, role: "owner" })))
      .returning()
  })
  afterEach(async () => {
    await db.delete(organization).where(eq(organization.id, group.id))
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
            return auth.api.leaveOrganization({ ...input, body: { organizationId: group.id } })
          if (operation === "remove")
            return auth.api.removeMember({
              ...input,
              body: { organizationId: group.id, memberIdOrEmail: owners[index]!.id },
            })
          return auth.api.updateMemberRole({
            ...input,
            body: { organizationId: group.id, memberId: owners[index]!.id, role: "viewer" },
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
        (await db.select().from(member).where(eq(member.organizationId, group.id))).filter(
          ({ role }) => role.split(",").includes("owner"),
        ),
      ).toHaveLength(1)
    },
  )

  test("bulk writes retain the guards inside adapter transactions", async () => {
    const adapter = authDatabaseAdapter()(clients[0]!.options)
    await expect(
      adapter.transaction((transaction) =>
        transaction.deleteMany({
          model: "account",
          where: [{ field: "userId", operator: "in", value: users.map(({ id }) => id) }],
        }),
      ),
    ).rejects.toMatchObject({ body: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT" } })
    await expect(
      adapter.updateMany({
        model: "member",
        where: [{ field: "organizationId", value: group.id }],
        update: { role: "viewer" },
      }),
    ).rejects.toMatchObject({
      body: { code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER" },
    })
    expect(await db.select().from(member).where(eq(member.organizationId, group.id))).toHaveLength(
      2,
    )
  })

  test("the last owner beyond the adapter's default page remains protected", async () => {
    await db.delete(member).where(eq(member.organizationId, group.id))
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
      .values(extra.map(({ id }) => ({ organizationId: group.id, userId: id, role: "viewer" })))
    await db
      .insert(member)
      .values({ organizationId: group.id, userId: users[0]!.id, role: "owner" })
    const adapter = authDatabaseAdapter()(clients[0]!.options)
    await expect(
      adapter.deleteMany({
        model: "member",
        where: [{ field: "organizationId", value: group.id }],
      }),
    ).rejects.toMatchObject({
      body: { code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER" },
    })
    expect(
      await adapter.count({
        model: "member",
        where: [{ field: "organizationId", value: group.id }],
      }),
    ).toBe(102)
  })
})
