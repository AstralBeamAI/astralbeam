import { Effect, Option, Schema, Stream } from "effect"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"
import type { TenantRestApi } from "./contract.server"
import { restHandleErrors } from "./responses.server"
import {
  restEmptyPage,
  restExamplePageCursors,
  restPageFields,
  restPageHeaders,
  restPageQuery,
  restScope,
  tenantRestKeys,
} from "./shared.server"
import {
  ApiUuidSchema,
  TenantUserPatchSchema,
  TenantUserRecordSchema as ManagementTenantUserRecordSchema,
  TenantUserWriteSchema,
} from "../../../../api/management.ts"
import { restExampleTenant, restMemberParams } from "./tenant.server"

const restExampleUser = {
  ...restExampleTenant,
  id: "019eed6a-d1c0-7543-b892-608cb6e174da",
  external_id: "user-7",
  name: "Alex Morgan",
  metadata: { role: "dispatcher", department: "operations" },
  tenant_id: restExampleTenant.id,
  admin: false,
}
export const TenantUserRecordSchema = Schema.Struct(
  ManagementTenantUserRecordSchema.fields,
).pipe(
  Schema.annotate({ identifier: "TenantUserRecord" }),
  Schema.encodeKeys({ ...tenantRestKeys, tenantId: "tenant_id" }),
  Schema.annotateEncoded({
    title: "TenantUserRecord",
    description:
      "Persisted TenantUser. Stored admin does not grant or revoke signed JWT authority.",
    examples: [restExampleUser],
  }),
)
const CreateTenantUserSchema = TenantUserWriteSchema.pipe(
  Schema.encodeKeys({ externalId: "external_id" }),
).pipe(
  Schema.annotateEncoded({
    identifier: "CreateTenantUserInput",
    examples: [
      {
        external_id: restExampleUser.external_id,
        name: restExampleUser.name,
        metadata: restExampleUser.metadata,
        admin: false,
      },
      { external_id: restExampleUser.external_id },
    ],
  }),
)
const UpdateTenantUserSchema = TenantUserPatchSchema.annotate({
  identifier: "UpdateTenantUserInput",
}).pipe(
  Schema.annotateEncoded({
    examples: [{ name: "Alex Morgan-Smith" }, { name: null, metadata: {} }],
  }),
)

export const tenantUserRestPage = Schema.Struct({
  items: Schema.Array(TenantUserRecordSchema),
  ...restPageFields,
}).pipe(Schema.annotateEncoded({
  identifier: "TenantUserPage",
  examples: [{ items: [restExampleUser], ...restExamplePageCursors }, restEmptyPage],
  description:
    "Live keyset page in ascending ID order within one Tenant. Pass either non-null continuation value as the same-named request parameter.",
}))
const restUserParams = {
  tenant_id: restMemberParams.id,
  id: ApiUuidSchema.annotate({ examples: [restExampleUser.id] }),
}

export const tenantUserApi = HttpApiGroup.make("tenant_users", { topLevel: true }).annotate(
  OpenApi.Override,
  {
    "x-displayName": "TenantUsers",
  },
).add(
  HttpApiEndpoint.get("listUsersForTenant", "/tenants/:tenant_id/tenant_users", {
    params: { tenant_id: restUserParams.tenant_id },
    query: restPageQuery,
    success: HttpApiSchema.WithHeaders(tenantUserRestPage, restPageHeaders),
  }).annotate(OpenApi.Summary, "List TenantUsers").annotate(
    OpenApi.Description,
    "List users of one Tenant in internal ID order, optionally filtered by exact external ID. No matching user returns an empty page; missing and out-of-scope Tenants return 404. Cursors cannot be reused for another Tenant or filter. Live listing, not a snapshot.",
  ),
  HttpApiEndpoint.post("createTenantUser", "/tenants/:tenant_id/tenant_users", {
    params: { tenant_id: restUserParams.tenant_id },
    payload: CreateTenantUserSchema,
    success: HttpApiSchema.WithHeaders(TenantUserRecordSchema, {
      Location: Schema.String,
    }).pipe(HttpApiSchema.status(201)),
  }).annotate(OpenApi.Summary, "Create a TenantUser").annotate(
    OpenApi.Description,
    "Create a TenantUser under the internal tenant_id path identifier, with a customer-provided tenant-local external_id. An external_id already used in this Tenant returns 409; the same external_id in another Tenant is allowed. Stored admin does not change signed JWT authority.",
  ),
  HttpApiEndpoint.get("getTenantUser", "/tenants/:tenant_id/tenant_users/:id", {
    params: restUserParams,
    success: TenantUserRecordSchema,
  }).annotate(OpenApi.Summary, "Get a TenantUser").annotate(
    OpenApi.Description,
    "Get a TenantUser by the internal tenant_id and id pair within the authorized scope. No identity upsert.",
  ),
  HttpApiEndpoint.patch("updateTenantUser", "/tenants/:tenant_id/tenant_users/:id", {
    params: restUserParams,
    payload: UpdateTenantUserSchema,
    success: TenantUserRecordSchema,
  }).annotate(OpenApi.Summary, "Update a TenantUser").annotate(
    OpenApi.Description,
    "Update supplied name/metadata/admin fields only. Stored admin does not grant or revoke JWT authority. name:null clears the name; metadata replaces the object.",
  ),
).annotate(
  OpenApi.Description,
  "A TenantUser is a user of one of your Organization's Tenants, not an employee using the dashboard. All routes use internal UUID tenant_id and user id values. External IDs are unique within the organization and Tenant; the same external user ID may exist in another Tenant. Creation returns 201 and Location; reads and updates return 200. PATCH changes only supplied fields. IDs, external IDs, ownership, and timestamps are immutable; users cannot move between Tenants. Updates use last-write-wins. Responses never expose organization_id; timestamps are ISO-8601 strings. Stored admin does not change signed JWT authority. Creation does not issue tokens or upsert identities. See [Errors](/docs/api#description/errors) for shared error handling.",
)

export function tenantUserHandlers(api: typeof TenantRestApi) {
  return HttpApiBuilder.group(
    api,
    "tenant_users",
    (handlers) =>
      Effect.gen(function* () {
        const { createTenantUser, getTenantUser, listTenantUsers, updateTenantUser } = yield* Effect
          .promise(() => import("@/db/tenant-user.server"))
        const { restPage, restPageOptions } = yield* Effect.promise(() =>
          import("./pagination.server")
        )
        return handlers.handleAll({
          listUsersForTenant: Effect.fn(function* ({ params, query, request }) {
            const scope = yield* restScope
            const tenantScope = { ...scope, tenantFilter: params.tenant_id }
            const { pageSize, backward, cursor, externalId } = yield* restPageOptions(
              query,
              "tenant_users",
              tenantScope,
            )
            const page = yield* listTenantUsers(scope, params.tenant_id, {
              pageSize,
              position: cursor,
              backward,
              externalId,
              includePrevious: true,
            }).pipe(Stream.runHead, Effect.map(Option.getOrThrow))
            return yield* Effect.promise(() =>
              restPage(page, "tenant_users", tenantScope, request.url, backward, externalId)
            )
          }, restHandleErrors("listUsersForTenant")),
          getTenantUser: Effect.fn(function* ({ params }) {
            return yield* getTenantUser(yield* restScope, params.tenant_id, params.id)
          }, restHandleErrors("getTenantUser")),
          createTenantUser: Effect.fn(function* ({ params, payload }) {
            const row = yield* createTenantUser(yield* restScope, params.tenant_id, payload)
            return HttpApiSchema.withHeaders({
              body: row,
              headers: { Location: `/api/v1/tenants/${row.tenantId}/tenant_users/${row.id}` },
            })
          }, restHandleErrors("createTenantUser")),
          updateTenantUser: Effect.fn(function* ({ params, payload }) {
            return yield* updateTenantUser(yield* restScope, params.tenant_id, params.id, payload)
          }, restHandleErrors("updateTenantUser")),
        })
      }),
  )
}
