import { readFileSync } from "node:fs"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool, type PoolClient } from "pg"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { organization, member, user, fileObject, tenant, tenantUser, chatFile } from "./schema"

const membershipMigrationUrl = process.env.DATABASE_URL
const membershipMigrationConfigured =
  membershipMigrationUrl && membershipMigrationUrl !== "postgres://test:test@127.0.0.1:5432/test"
if (
  membershipMigrationConfigured &&
  (new URL(membershipMigrationUrl).hostname !== "127.0.0.1" ||
    !new URL(membershipMigrationUrl).pathname.endsWith("_test"))
)
  throw new Error("Use a disposable loopback database ending in _test")
const membershipMigrationSql = readFileSync(
  new URL("./migrations/20261020181521_unique-organization-members/migration.sql", import.meta.url),
  "utf8",
)

describe.skipIf(!membershipMigrationConfigured)("unique membership populated upgrade", () => {
  let pool: Pool
  let client: PoolClient
  let db: Omit<ReturnType<typeof drizzle>, "$client">
  beforeEach(async () => {
    pool = new Pool({ connectionString: membershipMigrationUrl })
    client = await pool.connect()
    await client.query("BEGIN")
    await client.query(
      "DROP INDEX member_organization_user_uidx; CREATE INDEX member_organization_id_idx ON member (organization_id)",
    )
    db = drizzle({ client })
  })
  afterEach(async () => {
    await client.query("ROLLBACK")
    client.release()
    await pool.end()
  })
  async function pair() {
    const [org] = await db
      .insert(organization)
      .values({ name: "Upgrade", slug: `upgrade-${crypto.randomUUID()}` })
      .returning()
    const [person] = await db
      .insert(user)
      .values({
        name: "Upgrade",
        email: `${crypto.randomUUID()}@example.test`,
        emailVerified: true,
      })
      .returning()
    return { organizationId: org!.id, userId: person!.id }
  }

  test("preserves the canonical member and referenced avatars, retires only displaced unreferenced files", async () => {
    const scope = await pair()
    const files = await db
      .insert(fileObject)
      .values(
        Array.from({ length: 4 }, () => ({
          organizationId: scope.organizationId,
          objectKey: crypto.randomUUID(),
          contentType: "image/png",
          byteSize: 1,
          sha256: "0".repeat(64),
          status: "stored" as const,
        })),
      )
      .returning()
    await client.query("UPDATE organization SET logo_file_id = $1 WHERE id = $2", [
      files[1]!.id,
      scope.organizationId,
    ])
    const [customer] = await db
      .insert(tenant)
      .values({ organizationId: scope.organizationId, externalId: "upgrade" })
      .returning()
    const [uploader] = await db
      .insert(tenantUser)
      .values({
        organizationId: scope.organizationId,
        tenantId: customer!.id,
        externalId: "uploader",
      })
      .returning()
    await db.insert(chatFile).values({
      organizationId: scope.organizationId,
      tenantId: customer!.id,
      uploaderTenantUserId: uploader!.id,
      fileObjectId: files[2]!.id,
    })
    const rows: (typeof member.$inferSelect)[] = []
    for (const avatarFileId of [null, ...files.map((file) => file.id)]) {
      const [row] = await db
        .insert(member)
        .values({ ...scope, role: rows.length % 2 ? "viewer,owner" : "owner,viewer", avatarFileId })
        .returning()
      rows.push(row!)
    }
    await client.query(membershipMigrationSql)
    expect(
      (
        await client.query(
          "SELECT id, role, avatar_file_id FROM member WHERE organization_id = $1",
          [scope.organizationId],
        )
      ).rows,
    ).toEqual([{ id: rows[0]!.id, role: "owner,viewer", avatar_file_id: files[0]!.id }])
    expect(
      (
        await client.query<{ status: string }>(
          "SELECT status FROM file_object WHERE organization_id = $1 ORDER BY id",
          [scope.organizationId],
        )
      ).rows.map((row) => row.status),
    ).toEqual(["stored", "stored", "stored", "purging"])
    await expect(
      client.query(
        "INSERT INTO member (organization_id, user_id, role) VALUES ($1, $2, 'viewer')",
        [scope.organizationId, scope.userId],
      ),
    ).rejects.toMatchObject({ code: "23505" })
  })

  test.each(["viewer", "unknown", "", "owner,"])(
    "conflicting or invalid role %j rolls back without changing memberships",
    async (role) => {
      const scope = await pair()
      const rows = await db
        .insert(member)
        .values([
          { ...scope, role: "owner" },
          { ...scope, role },
        ])
        .returning()
      await client.query("SAVEPOINT upgrade")
      await expect(client.query(membershipMigrationSql)).rejects.toThrow(
        "Conflicting duplicate organization memberships",
      )
      await client.query("ROLLBACK TO SAVEPOINT upgrade")
      expect(
        (
          await client.query("SELECT id, role FROM member WHERE organization_id = $1 ORDER BY id", [
            scope.organizationId,
          ])
        ).rows,
      ).toEqual(rows.map(({ id, role }) => ({ id, role })))
      expect(
        (
          await client.query(
            "SELECT to_regclass('member_organization_id_idx') AS old_index, to_regclass('member_organization_user_uidx') AS new_index",
          )
        ).rows[0],
      ).toEqual({ old_index: "member_organization_id_idx", new_index: null })
    },
  )
})
