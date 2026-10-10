import { jwtVerify } from "jose"
import { Effect, Schema } from "effect"
import { and, asc, eq } from "drizzle-orm"
import { Database } from "@/db/database"
import { user } from "@/db/schema/authentication"
import { member } from "@/db/schema/organizations"
import { parseApiKeyId } from "@/lib/api-keys/schemas"
import { ChatAuthenticationError } from "@/lib/chat/errors"
import { APP_HANDLE } from "@/lib/constants"
import { EmailAddressSchema } from "@/lib/schemas"
import { authenticateOrganizationIssuedToken } from "../chat/auth"
import { OrganizationMembershipError } from "./errors.ts"

export const ORGANIZATION_TOKEN_TYPE = `${APP_HANDLE}-organization+jwt`
export type OrganizationCurrentUser = Pick<typeof user.$inferSelect, "id" | "name" | "email"> & {
  role: typeof member.$inferSelect.role
}
const decodeOrganizationTokenClaims = Schema.decodeUnknownEffect(
  Schema.Struct({
    ver: Schema.Literal(1),
    iss: Schema.String,
    aud: Schema.Literal(APP_HANDLE),
    email: EmailAddressSchema,
    organization_id: Schema.String,
    iat: Schema.Int,
    exp: Schema.Int,
  }),
  { onExcessProperty: "error" },
)

export const verifyOrganizationToken = Effect.fn("verifyOrganizationToken")(
  function* (token: string, verifier: Uint8Array, keyId: string) {
    const issuer = parseApiKeyId(keyId)?.organizationId
    if (!issuer) return yield* new ChatAuthenticationError()
    // Separate types and strict claims prevent cross-JWT substitution. https://www.rfc-editor.org/rfc/rfc8725#section-3.12
    const { payload, protectedHeader } = yield* Effect.tryPromise({
      try: () =>
        jwtVerify(token, verifier, {
          algorithms: ["HS256"],
          typ: ORGANIZATION_TOKEN_TYPE,
          issuer,
          audience: APP_HANDLE,
          requiredClaims: ["iss", "aud", "email", "organization_id", "iat", "exp"],
          clockTolerance: 30,
          maxTokenAge: 600,
        }),
      catch: () => new ChatAuthenticationError(),
    })
    const claims = yield* decodeOrganizationTokenClaims(payload)
    if (
      protectedHeader.kid !== keyId ||
      claims.organization_id !== issuer ||
      claims.exp - claims.iat < 60 ||
      claims.exp - claims.iat > 600
    ) {
      return yield* new ChatAuthenticationError()
    }
    return { email: claims.email, organizationId: claims.organization_id }
  },
  Effect.catchTag("SchemaError", () => Effect.fail(new ChatAuthenticationError())),
)

export const authenticateOrganizationRequest = Effect.fn("authenticateOrganizationRequest")(
  function* (request: Request) {
    const principal = yield* authenticateOrganizationIssuedToken(request, verifyOrganizationToken)
    const database = yield* Database
    const [currentUser] = yield* database
      .select({
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
      .pipe(Effect.orDie)
    if (!currentUser) return yield* new OrganizationMembershipError()
    return { ...principal, currentUser }
  },
)
