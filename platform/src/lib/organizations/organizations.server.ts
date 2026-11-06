import { and, asc, count, eq, gt, isNull, like, or, sql } from "drizzle-orm"
import { Context, Effect, Layer, Schema } from "effect"

import { Database } from "@/db/database"
import { cacheEntry } from "@/db/schema/cache"
import { Auth } from "@/lib/auth/auth.server"
import { ORGANIZATION_API_KEY_CONFIG_ID } from "@/lib/api-keys/schemas"
import { Config } from "@/lib/config/config"
import { UuidV7Schema } from "@/lib/schemas"
import type { OrganizationId } from "@/db/schema/organizations"
import { apiKey, member, organization, OrganizationIdSchema } from "@/db/schema/organizations"
import { SlugSchema } from "./slug.ts"
import {
  INTEGRATION_GUIDE_CACHE_NAMESPACE,
  type IntegrationGuideStep,
  IntegrationGuideStepSchema,
} from "./schemas.ts"
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
    organizationId: OrganizationIdSchema,
    organizationSlug: SlugSchema,
    organizationName: Schema.String,
    role: Schema.String,
    memberId: UuidV7Schema,
    avatarFileId: Schema.NullOr(UuidV7Schema),
  }),
  { onExcessProperty: "error" },
)

export type OrganizationMembership = Effect.Success<ReturnType<typeof decodeOrganizationMembership>>

type AccessFailure = SignInRequired | OrganizationNotFound | OrganizationAccessDenied

export class Organizations extends Context.Service<
  Organizations,
  {
    /** Turns a URL slug into the organization the user actually belongs to, or `null`. */
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
    /** The display identity of an organization whose ID came from a verified credential. */
    readonly summary: (
      organizationId: string,
    ) => Effect.Effect<{ readonly id: string; readonly name: string; readonly slug: string } | null>
    /** Enabled, unexpired dashboard keys, or `null` when the reader's role cannot see keys. */
    readonly usableApiKeyCount: (input: {
      readonly organizationId: OrganizationId
      readonly permissions: Pick<OrganizationPermissions, "readApiKey">
    }) => Effect.Effect<number | null>
    /** Integration guide steps that members marked complete, shared across the organization. */
    readonly markedGuideSteps: (
      organizationId: OrganizationId,
    ) => Effect.Effect<ReadonlyArray<IntegrationGuideStep>>
    readonly markGuideStep: (input: {
      readonly organizationId: OrganizationId
      readonly step: IntegrationGuideStep
      readonly marked: boolean
    }) => Effect.Effect<void>
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
            memberId: member.id,
            avatarFileId: member.avatarFileId,
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

      const summary = Effect.fn("Organizations.summary")(function* (organizationId: string) {
        const [row] = yield* db
          .select({ id: organization.id, name: organization.name, slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, organizationId))
          .limit(1)
        return row ?? null
      }, Effect.orDie)

      const usableApiKeyCount = Effect.fn("Organizations.usableApiKeyCount")(function* (
        input: Parameters<typeof Organizations.Service.usableApiKeyCount>[0],
      ) {
        if (!input.permissions.readApiKey) return null
        const [row] = yield* db
          .select({ value: count() })
          .from(apiKey)
          .where(
            and(
              eq(apiKey.organizationId, input.organizationId),
              eq(apiKey.configId, ORGANIZATION_API_KEY_CONFIG_ID),
              eq(apiKey.enabled, true),
              or(isNull(apiKey.expiresAt), gt(apiKey.expiresAt, sql`now()`)),
            ),
          )
        return row?.value ?? 0
      }, Effect.orDie)

      // Durable cache rows without TTL, one per marked step, so concurrent toggles never conflict.
      const guideMarkKey = (organizationId: OrganizationId, step: IntegrationGuideStep) =>
        `${organizationId}:${step}`

      const markedGuideSteps = Effect.fn("Organizations.markedGuideSteps")(function* (
        organizationId: OrganizationId,
      ) {
        const rows = yield* db
          .select({ key: cacheEntry.key })
          .from(cacheEntry)
          .where(
            and(
              eq(cacheEntry.namespace, INTEGRATION_GUIDE_CACHE_NAMESPACE),
              like(cacheEntry.key, `${organizationId}:%`),
            ),
          )
        const keys = new Set(rows.map((row) => row.key))
        return IntegrationGuideStepSchema.literals.filter((step) =>
          keys.has(guideMarkKey(organizationId, step)),
        )
      }, Effect.orDie)

      const markGuideStep = Effect.fn("Organizations.markGuideStep")(function* (
        input: Parameters<typeof Organizations.Service.markGuideStep>[0],
      ) {
        const key = guideMarkKey(input.organizationId, input.step)
        if (input.marked)
          yield* db
            .insert(cacheEntry)
            .values({ namespace: INTEGRATION_GUIDE_CACHE_NAMESPACE, key, value: "true" })
            .onConflictDoNothing()
        else
          yield* db
            .delete(cacheEntry)
            .where(
              and(
                eq(cacheEntry.namespace, INTEGRATION_GUIDE_CACHE_NAMESPACE),
                eq(cacheEntry.key, key),
              ),
            )
      }, Effect.orDie)

      return Organizations.of({
        membership,
        access,
        summary,
        usableApiKeyCount,
        markedGuideSteps,
        markGuideStep,
      })
    }),
  )

  static readonly layer = Organizations.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(Auth.layer, Config.layer, Database.layer)),
  )
}
