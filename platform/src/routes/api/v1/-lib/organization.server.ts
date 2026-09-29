import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"
import type { ApiV1 } from "./contract.server"
import { ApiUuidSchema } from "../../../../lib/tenants/schemas.ts"
import { RestOrganizationNotFound, RestTenantTokenForbidden } from "./errors.ts"
import { RestScope } from "./shared.server"

const OrganizationSchema = Schema.Struct({
  id: ApiUuidSchema,
  name: Schema.String,
  slug: Schema.String.annotate({
    description: "Editable dashboard URL segment. Use id, not slug, as the stable identity.",
  }),
}).pipe(
  Schema.annotateEncoded({
    identifier: "Organization",
    examples: [{ id: "019eed68-fd00-7c42-9a61-53b3a890d276", name: "Acme", slug: "acme" }],
  }),
)

export const organizationApi = HttpApiGroup.make("organization", { topLevel: true })
  .annotate(OpenApi.Override, { "x-displayName": "Organization" })
  .add(
    HttpApiEndpoint.get("getOrganization", "/organization", { success: OrganizationSchema })
      .annotate(OpenApi.Summary, "Get the current Organization")
      .annotate(
        OpenApi.Description,
        "Return the id, name, and slug of the Organization that owns the credential. Accepts an organization API key or organization-management JWT, including a viewer's. Tenant JWTs are forbidden.",
      )
      .annotate(OpenApi.Override, {
        security: [{ OrganizationApiKey: [] }, { organizationToken: [] }],
      }),
  )

export function organizationHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "organization",
    Effect.fn(function* (handlers) {
      const { Database } = yield* Effect.promise(() => import("@/db/database.server"))
      const { readOrganizationSummary } = yield* Effect.promise(
        () => import("@/lib/organizations/organizations.server"),
      )
      const database = yield* Database
      return handlers.handle(
        "getOrganization",
        Effect.fn("getOrganization")(function* () {
          const scope = yield* RestScope
          if (scope.externalTenantId !== undefined) return yield* new RestTenantTokenForbidden()
          // Seam: reads through the organizations module until it exposes a service.
          const row = yield* readOrganizationSummary(scope.organizationId).pipe(
            Effect.provideService(Database, database),
            Effect.orDie,
          )
          if (!row) return yield* new RestOrganizationNotFound()
          return row
        }),
      )
    }),
  )
}
