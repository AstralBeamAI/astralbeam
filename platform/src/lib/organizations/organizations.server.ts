import { and, asc, count, eq } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database.server"
import {
  agent,
  apiKey,
  member,
  organization,
  sandboxProvider,
} from "@/db/schema/organizations.server"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config.server"
import { SlugSchema, UuidV7Schema } from "@/lib/schemas"
import {
  authorizeOrganizationRole,
  deriveOrganizationPermissions,
  type OrganizationAccess,
  type OrganizationPermissionRequest,
  type OrganizationPermissions,
} from "./access.ts"
import { OrganizationAccessDenied, OrganizationNotFound, SignInRequired } from "./errors.ts"

const decodeOrganizationMembership = Schema.decodeUnknownEffect(
  Schema.Struct({
    organizationId: UuidV7Schema,
    organizationSlug: SlugSchema,
    organizationName: Schema.String,
    role: Schema.String,
  }),
  { onExcessProperty: "error" },
)

export type OrganizationMembership = Effect.Success<ReturnType<typeof decodeOrganizationMembership>>

/** `null` where the reader's role does not permit the resource, so the payload leaks no count. */
export interface OrganizationResourceCounts {
  readonly agents: number | null
  readonly sandboxProviders: number | null
  readonly apiKeys: number | null
  readonly members: number
}

type OrganizationOwnedTable = typeof agent | typeof apiKey | typeof member | typeof sandboxProvider

type AccessFailure = SignInRequired | OrganizationNotFound | OrganizationAccessDenied

/** The display identity of an organization whose ID came from a verified credential. */
export function readOrganizationSummary(organizationId: string) {
  return Effect.gen(function* () {
    const db = yield* Database
    const [row] = yield* db
      .select({ id: organization.id, name: organization.name, slug: organization.slug })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
    return row
  })
}

export class Organizations extends Context.Service<
  Organizations,
  {
    /**
     * Turns a URL slug into the organization the user actually belongs to, or `null`. Better
     * Auth's `member` has no `(organization_id, user_id)` uniqueness, so the order is explicit.
     */
    readonly membership: (input: {
      readonly organizationSlug: string
      readonly userId: string
    }) => Effect.Effect<OrganizationMembership | null>
    /** The caller's membership and role, plus one permission when given, memoized per request
     * headers. A missing organization and a non-member fail alike. */
    readonly access: (input: {
      readonly headers: Headers
      readonly organizationSlug: string
      readonly permissions?: OrganizationPermissionRequest | undefined
    }) => Effect.Effect<OrganizationAccess, AccessFailure>
    /** The dashboard's one read: how much of each resource the organization has configured. */
    readonly resourceCounts: (input: {
      readonly organizationId: string
      readonly permissions: OrganizationPermissions
    }) => Effect.Effect<OrganizationResourceCounts>
  }
>()("astralbeam/organizations/Organizations") {
  static readonly layerNoDeps = Layer.effect(
    Organizations,
    Effect.gen(function* () {
      const db = yield* Database
      const auth = yield* Auth
      const config = yield* Config
      const accessByRequest = new WeakMap<
        Headers,
        Map<string, Effect.Effect<OrganizationAccess, AccessFailure>>
      >()

      const membership = Effect.fn("Organizations.membership")(function* (input: {
        organizationSlug: string
        userId: string
      }) {
        const [row] = yield* db
          .select({
            organizationId: organization.id,
            organizationSlug: organization.slug,
            organizationName: organization.name,
            role: member.role,
          })
          .from(organization)
          .innerJoin(
            member,
            and(eq(member.organizationId, organization.id), eq(member.userId, input.userId)),
          )
          .where(eq(organization.slug, input.organizationSlug))
          .orderBy(asc(member.id))
          .limit(1)
        return row ? yield* decodeOrganizationMembership(row) : null
      }, Effect.orDie)

      const resolveAccess = Effect.fnUntraced(function* (input: {
        headers: Headers
        organizationSlug: string
      }) {
        // Better Auth cannot be built before setup completes.
        if (!(yield* config.setupState).setupComplete) return yield* new OrganizationAccessDenied()
        const session = yield* auth.getSession({ headers: input.headers })
        if (!session) return yield* new SignInRequired()
        const found = yield* membership({
          organizationSlug: input.organizationSlug,
          userId: session.user.id,
        })
        if (!found) return yield* new OrganizationNotFound()
        return { ...found, permissions: deriveOrganizationPermissions(found.role) }
      })

      const access = Effect.fn("Organizations.access")(function* (input: {
        headers: Headers
        organizationSlug: string
        permissions?: OrganizationPermissionRequest | undefined
      }) {
        const requestAccess =
          accessByRequest.get(input.headers) ??
          new Map<string, Effect.Effect<OrganizationAccess, AccessFailure>>()
        accessByRequest.set(input.headers, requestAccess)
        let resolved = requestAccess.get(input.organizationSlug)
        if (!resolved) {
          resolved = yield* Effect.cached(resolveAccess(input))
          requestAccess.set(input.organizationSlug, resolved)
        }
        const granted = yield* resolved
        if (input.permissions && !authorizeOrganizationRole(granted.role, input.permissions)) {
          return yield* new OrganizationAccessDenied()
        }
        return granted
      })

      const resourceCounts = Effect.fn("Organizations.resourceCounts")(function* (input: {
        organizationId: string
        permissions: OrganizationPermissions
      }) {
        const countRows = (table: OrganizationOwnedTable) =>
          db
            .select({ value: count() })
            .from(table)
            .where(eq(table.organizationId, input.organizationId))
            .pipe(
              Effect.map((rows) => rows[0]?.value ?? 0),
              Effect.orDie,
            )
        const countIf = (allowed: boolean, table: OrganizationOwnedTable) =>
          allowed ? countRows(table) : Effect.succeed(null)
        const [agents, sandboxProviders, apiKeys, members] = yield* Effect.all([
          countIf(input.permissions.readConfiguration, agent),
          countIf(input.permissions.readConfiguration, sandboxProvider),
          countIf(input.permissions.readApiKey, apiKey),
          countRows(member),
        ])
        return { agents, sandboxProviders, apiKeys, members }
      })

      return Organizations.of({
        membership,
        access,
        resourceCounts,
      })
    }),
  )

  static readonly layer = Organizations.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(Auth.layer, Config.layer, Database.layer)),
  )
}
