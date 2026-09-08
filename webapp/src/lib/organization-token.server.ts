import { jwtVerify } from "jose"
import { Data, Effect, Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { effectDatabase } from "@/db"
import { user } from "@/db/schema/authentication.server"
import { member } from "@/db/schema/organizations.server"
import { authenticateOrganizationIssuedToken } from "./chat/auth.server"

export const ORGANIZATION_TOKEN_TYPE = "astralbeam-organization+jwt"
export type OrganizationCurrentUser = Pick<typeof user.$inferSelect, "id" | "name" | "email"> & {
  role: typeof member.$inferSelect.role
}
export class OrganizationMembershipError extends Data.TaggedError("OrganizationMembershipError") {}
const organizationTokenClaims = Schema.Struct({
  ver: Schema.Literal(1),
  iss: Schema.String,
  aud: Schema.Literal("astralbeam"),
  email: Schema.String.check(
    Schema.isPattern(/^[^\s@]+@[^\s@]+$/),
    Schema.isMaxLength(320),
    Schema.makeFilter((value) => !value.includes("\0")),
  ),
  organization_id: Schema.String,
  iat: Schema.Int,
  exp: Schema.Int,
})

export async function verifyOrganizationToken(token: string, verifier: Uint8Array, keyId: string) {
  try {
    const issuer = keyId.split("_")[1]
    if (!issuer) throw new Error("Invalid key identifier")
    // Separate types and strict claims prevent cross-JWT substitution. https://www.rfc-editor.org/rfc/rfc8725#section-3.12
    const { payload, protectedHeader } = await jwtVerify(token, verifier, {
      algorithms: ["HS256"],
      typ: ORGANIZATION_TOKEN_TYPE,
      issuer,
      audience: "astralbeam",
      requiredClaims: ["iss", "aud", "email", "organization_id", "iat", "exp"],
      clockTolerance: 30,
      maxTokenAge: 600,
    })
    const claims = Schema.decodeUnknownSync(organizationTokenClaims, { onExcessProperty: "error" })(
      payload,
    )
    if (
      protectedHeader.kid !== keyId || claims.organization_id !== issuer ||
      claims.exp - claims.iat < 60 || claims.exp - claims.iat > 600
    ) {
      throw new Error("Invalid organization token")
    }
    return { email: claims.email, organizationId: claims.organization_id }
  } catch (cause) {
    throw Object.assign(new Error("Invalid organization token", { cause }), {
      code: "invalid_token",
    })
  }
}

export function authenticateOrganizationRequest(request: Request) {
  return Effect.gen(function* () {
    const principal = yield* authenticateOrganizationIssuedToken(request, verifyOrganizationToken)
    const database = yield* effectDatabase
    const [currentUser] = yield* database.select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
    })
      .from(user)
      .innerJoin(
        member,
        and(eq(member.userId, user.id), eq(member.organizationId, principal.organizationId)),
      )
      .where(eq(user.email, principal.identity.email))
      .orderBy(asc(member.id))
      .limit(1)
    if (!currentUser) return yield* Effect.fail(new OrganizationMembershipError())
    return { ...principal, currentUser }
  })
}
