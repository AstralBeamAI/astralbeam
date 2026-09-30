import { Effect, Schema } from "effect"
import { HttpServerRequest } from "effect/http"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import type { ApiV1 } from "./contract.server"
import { ApiUuidSchema } from "../../../../lib/tenants/schemas.ts"
import { TenantRecordSchema } from "./tenant.server"
import { TenantUserRecordSchema } from "./tenant-user.server"

const currentUserOrganization = Schema.Struct({ id: ApiUuidSchema })
const CurrentUserSchema = Schema.Union([
  Schema.Struct({
    scope: Schema.Literal("tenant"),
    organization: currentUserOrganization,
    tenant: TenantRecordSchema,
    user: TenantUserRecordSchema,
  }),
  Schema.Struct({
    scope: Schema.Literal("organization"),
    organization: currentUserOrganization,
    user: Schema.Struct({
      id: ApiUuidSchema,
      name: Schema.String,
      email: Schema.String,
      role: Schema.String,
    }),
  }),
]).annotate({ identifier: "CurrentUser" })

export const currentUserApi = HttpApiGroup.make("currentUser", { topLevel: true }).add(
  HttpApiEndpoint.post("getCurrentUser", "/me", {
    success: CurrentUserSchema,
  })
    .annotate(OpenApi.Summary, "Get the current user")
    .annotate(
      OpenApi.Description,
      "Use a tenant JWT to upsert its own Tenant and TenantUser atomically, without requiring admin authority. Supplied names and metadata replace stored values, omitted profile fields and admin are preserved, and an explicit admin claim updates stored admin. An organization JWT returns existing user membership and the current database role without provisioning identities. API keys and cookies are not accepted. Limited to 100 requests per five minutes per identity.",
    )
    .annotate(OpenApi.Override, { security: [{ astralBeamToken: [] }, { organizationToken: [] }] }),
)

export function currentUserHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "currentUser",
    Effect.fn("currentUserHandlers")(function* (handlers) {
      const { getCurrentUser } = yield* Effect.promise(() => import("./current-user-auth.server"))
      const context = yield* Effect.context<Effect.Services<ReturnType<typeof getCurrentUser>>>()
      return handlers.handle(
        "getCurrentUser",
        Effect.fn("getCurrentUser")(function* ({ request }) {
          const native = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie)
          return yield* getCurrentUser(native).pipe(Effect.provideContext(context))
        }),
      )
    }),
  )
}
