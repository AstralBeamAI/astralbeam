import type { DBAdapter } from "@better-auth/core/db/adapter"
import { BASE_ERROR_CODES } from "@better-auth/core/error"
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2"
import { APIError } from "better-auth/api"
import { inArray } from "drizzle-orm"

import { getAuthDatabase } from "@/db/database"
import { organization, tables, user } from "@/db/schema"

type AuthDatabase = ReturnType<typeof getAuthDatabase>
type AuthTransaction = Parameters<Parameters<AuthDatabase["transaction"]>[0]>[0]
type AuthMutation = Parameters<DBAdapter["delete"]>[0]

// Retain these write-time checks until Better Auth serializes its last-account/owner prechecks.
// https://github.com/better-auth/better-auth/tree/v1.7.7/packages/better-auth/src
async function guardAuthRemoval(
  database: AuthDatabase | AuthTransaction,
  adapter: DBAdapter,
  mutation: AuthMutation,
  deleting: boolean,
) {
  const accounts = mutation.model === "account"
  const field = accounts ? "userId" : "organizationId"
  const readOwnership = (where: AuthMutation["where"]) =>
    adapter.findMany<{ id: string; userId: string; organizationId: string; role?: string }>({
      model: mutation.model,
      where,
      select: accounts ? ["id", "userId"] : ["id", "organizationId", "role"],
      limit: Number.MAX_SAFE_INTEGER,
    })
  const selected = await readOwnership(mutation.where)
  const parents = [...new Set(selected.map((row) => row[field]))]
  if (parents.length === 0) return
  // Parent rows provide one shared lock even when requests mutate different accounts or owners.
  const parentTable = accounts ? user : organization
  await database
    .select({ id: parentTable.id })
    .from(parentTable)
    .where(inArray(parentTable.id, parents))
    .orderBy(parentTable.id)
    .for("update")
  const targets = new Set((await readOwnership(mutation.where)).map(({ id }) => id))
  for (const parent of parents) {
    const rows = await readOwnership([{ field, value: parent }])
    const protectedRows = accounts
      ? rows
      : rows.filter((row) => row.role?.split(",").includes("owner"))
    if (protectedRows.length === 0 || protectedRows.some(({ id }) => !targets.has(id))) continue
    if (accounts) throw APIError.from("BAD_REQUEST", BASE_ERROR_CODES.FAILED_TO_UNLINK_LAST_ACCOUNT)
    throw new APIError(
      "BAD_REQUEST",
      deleting
        ? {
            code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER",
            message: "You cannot leave the organization as the only owner",
          }
        : {
            code: "YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER",
            message: "You cannot leave the organization without an owner",
          },
    )
  }
}

/** Adapter transactions retain these guards, including nested Better Auth membership deletes. */
export function authDatabaseAdapter(
  database: AuthDatabase | AuthTransaction = getAuthDatabase(),
  inTransaction = false,
): ReturnType<typeof drizzleAdapter> {
  return (options) => {
    const buildAdapter = (database: AuthDatabase | AuthTransaction) =>
      drizzleAdapter(database, { provider: "pg", schema: tables, transaction: false })(options)
    const original = buildAdapter(database)
    const adapter = { ...original }
    const run = <A>(
      operation: (database: AuthDatabase | AuthTransaction, adapter: DBAdapter) => Promise<A>,
    ) =>
      inTransaction
        ? operation(database, adapter)
        : database.transaction((transaction) => operation(transaction, buildAdapter(transaction)))
    const guarded = <A>(
      mutation: AuthMutation,
      deleting: boolean,
      operation: (adapter: DBAdapter) => Promise<A>,
    ) =>
      run(async (transaction, transactionalAdapter) => {
        await guardAuthRemoval(transaction, transactionalAdapter, mutation, deleting)
        return operation(transactionalAdapter)
      })
    const removingOwner = (input: Parameters<DBAdapter["update"]>[0]) =>
      input.model === "member" &&
      typeof input.update.role === "string" &&
      !input.update.role.split(",").includes("owner")
    const removingIdentity = (input: AuthMutation) =>
      input.model === "account" || input.model === "member"
    // Schema validation is registered by adapter identity, so keep the original object.
    // https://github.com/better-auth/better-auth/tree/v1.7.7/packages/core/src/db
    return Object.assign(original, {
      transaction: (operation) =>
        inTransaction
          ? operation(original)
          : database.transaction((transaction) =>
              operation(authDatabaseAdapter(transaction, true)(options)),
            ),
      delete: (input) =>
        removingIdentity(input)
          ? guarded(input, true, (transaction) => transaction.delete(input))
          : adapter.delete(input),
      update: (input) =>
        removingOwner(input)
          ? guarded(input, false, (transaction) => transaction.update(input))
          : adapter.update(input),
    } satisfies Partial<DBAdapter>)
  }
}
