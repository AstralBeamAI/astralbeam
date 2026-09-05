import { hashPassword } from "better-auth/crypto"
import { sql } from "drizzle-orm"

import { account, user } from "../../src/db/schema.server.ts"

import type { SeedTransaction } from "./database.ts"
import { SEED_PASSWORD, SEED_USERS } from "./fixtures.ts"

/**
 * Better Auth writes this exact issuer for an email/password account, as
 * `createLocalAccountIssuer("credential")`, and looks accounts up by it during sign-in.
 * https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/sign-up.ts
 */
const SEED_CREDENTIAL_ISSUER = "local:credential"
const SEED_CREDENTIAL_PROVIDER_ID = "credential"

/**
 * Creates the dashboard accounts, already email-verified.
 *
 * Signing up through the UI would need a reachable SMTP sink, because verification email delivery
 * blocks the signup request; seeding verified users removes that dependency for every flow that is
 * not itself testing signup. `termsAcceptedAt` stays null: it is only required when a legal policy
 * URL is configured, and the seed configures none.
 */
export async function seedUsers(transaction: SeedTransaction): Promise<Map<string, string>> {
  const userIdsByEmail = new Map<string, string>()
  for (const seedUser of SEED_USERS) {
    const [inserted] = await transaction
      .insert(user)
      .values({ email: seedUser.email, name: seedUser.name, emailVerified: true })
      .onConflictDoUpdate({
        target: user.email,
        set: { name: seedUser.name, emailVerified: true, updatedAt: sql`now()` },
      })
      .returning({ id: user.id })
    if (!inserted) throw new Error(`PostgreSQL did not return a row for '${seedUser.email}'`)
    userIdsByEmail.set(seedUser.email, inserted.id)

    // Better Auth's own scrypt hasher, so a seeded password verifies exactly like a real one.
    const password = await hashPassword(SEED_PASSWORD)
    await transaction
      .insert(account)
      .values({
        issuer: SEED_CREDENTIAL_ISSUER,
        accountId: inserted.id,
        providerId: SEED_CREDENTIAL_PROVIDER_ID,
        userId: inserted.id,
        password,
      })
      .onConflictDoUpdate({
        target: [account.issuer, account.accountId],
        set: { password, userId: inserted.id, updatedAt: sql`now()` },
      })
  }
  return userIdsByEmail
}
