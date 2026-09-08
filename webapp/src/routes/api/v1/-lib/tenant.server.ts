import { Effect, Option, Schema, Stream } from "effect"
import {
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"
import type { ApiV1 } from "./contract.server"
import { restHandleErrors } from "./responses.server"
import {
  restEmptyPage,
  restExamplePageCursors,
  restPageFields,
  restPageHeaders,
  restPageQuery,
  restResourceSecurity,
  restScope,
  tenantRestKeys,
} from "./shared.server"
import {
  ApiUuidSchema,
  TenantPatchSchema,
  TenantRecordSchema as ManagementTenantRecordSchema,
  TenantWriteSchema,
} from "../../../../api/management.ts"

export const restExampleTenant = {
  id: "019eed68-fd00-7c42-9a61-53b3a890d276",
  external_id: "customer-42",
  name: "Acme Logistics",
  metadata: { plan: "pro", region: "eu-west-1" },
  created_at: "2026-06-22T09:30:00.000Z",
  updated_at: "2026-06-22T09:30:00.000Z",
}
// Name decoded schemas so list and member responses share one encoded model. https://github.com/Effect-TS/effect/blob/effect%404.0.0-rc.112/packages/effect/src/SchemaRepresentation.ts
export const TenantRecordSchema = Schema.Struct(
  ManagementTenantRecordSchema.fields,
).pipe(
  Schema.annotate({ identifier: "TenantRecord" }),
  Schema.encodeKeys(tenantRestKeys),
  Schema.annotateEncoded({
    title: "TenantRecord",
    description: "Persisted Tenant; id is internal, external_id is the customer's exact identity.",
    examples: [restExampleTenant],
  }),
)
const CreateTenantSchema = TenantWriteSchema.pipe(Schema.encodeKeys({ externalId: "external_id" }))
  .pipe(
    Schema.annotateEncoded({
      identifier: "CreateTenantInput",
      examples: [
        {
          external_id: restExampleTenant.external_id,
          name: restExampleTenant.name,
          metadata: restExampleTenant.metadata,
        },
        { external_id: restExampleTenant.external_id },
      ],
    }),
  )
const UpdateTenantSchema = TenantPatchSchema.annotate({ identifier: "UpdateTenantInput" }).pipe(
  Schema.annotateEncoded({
    examples: [{ metadata: { plan: "enterprise", region: "eu-west-1" } }, {
      name: null,
      metadata: {},
    }],
  }),
)
export const tenantRestPage = Schema.Struct({
  items: Schema.Array(TenantRecordSchema),
  ...restPageFields,
})
  .pipe(Schema.annotateEncoded({
    identifier: "TenantPage",
    examples: [{ items: [restExampleTenant], ...restExamplePageCursors }, restEmptyPage],
    description:
      "Live keyset page. Pass either non-null continuation value as the same-named request parameter.",
  }))
export const restMemberParams = { id: ApiUuidSchema.annotate({ examples: [restExampleTenant.id] }) }

export const tenantApi = HttpApiGroup.make("tenants", { topLevel: true }).annotate(
  OpenApi.Override,
  {
    "x-displayName": "Tenants",
  },
).add(
  HttpApiEndpoint.get("listTenants", "/tenants", {
    query: restPageQuery,
    success: HttpApiSchema.WithHeaders(tenantRestPage, restPageHeaders),
  }).annotate(OpenApi.Summary, "List Tenants").annotate(
    OpenApi.Description,
    "List Tenants in internal ID order, optionally filtered by exact external ID. No match returns an empty page. Organization keys see their organization; admin JWTs see only their signed Tenant. Keep filters unchanged when reusing cursors. Live listing, not a snapshot.",
  ),
  HttpApiEndpoint.post("createTenant", "/tenants", {
    payload: CreateTenantSchema,
    success: HttpApiSchema.WithHeaders(TenantRecordSchema, {
      Location: Schema.String,
    }).pipe(HttpApiSchema.status(201)),
  }).annotate(OpenApi.Summary, "Create a Tenant").annotate(
    OpenApi.Description,
    "Create a Tenant with an exact customer-provided external_id. Requires an organization API key. An external_id already used in this organization returns 409; creation never upserts.",
  ),
  HttpApiEndpoint.get("getTenant", "/tenants/:id", {
    params: restMemberParams,
    success: TenantRecordSchema,
  }).annotate(OpenApi.Summary, "Get a Tenant").annotate(
    OpenApi.Description,
    "Get a Tenant by internal UUID, not external_id.",
  ),
  HttpApiEndpoint.patch("updateTenant", "/tenants/:id", {
    params: restMemberParams,
    payload: UpdateTenantSchema,
    success: TenantRecordSchema,
  }).annotate(OpenApi.Summary, "Update a Tenant").annotate(
    OpenApi.Description,
    "Update supplied name/metadata fields only. Requires an organization API key. name:null clears the name; metadata replaces the object. Last-write-wins; no upsert.",
  ),
).annotateEndpoints(OpenApi.Override, restResourceSecurity).annotate(
  OpenApi.Description,
  "A Tenant is one of your Organization's customers. Use internal UUID IDs in resource paths and your own customer identity as external_id. External IDs are unique within the organization. Creation returns 201 and Location; reads and updates return 200. PATCH changes only supplied fields. IDs, external IDs, ownership, and timestamps are immutable. Updates use last-write-wins. Responses never expose organization_id; timestamps are ISO-8601 strings. These APIs neither issue tokens nor upsert identities. See [Errors](/docs/api#description/errors) for shared error handling.",
)

export function tenantHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(
    api,
    "tenants",
    (handlers) =>
      Effect.gen(function* () {
        const { createTenant, getTenant, listTenants, updateTenant } = yield* Effect.promise(() =>
          import("@/db/tenant.server")
        )
        const { restPage, restPageOptions } = yield* Effect.promise(() =>
          import("./pagination.server")
        )
        return handlers.handleAll({
          listTenants: Effect.fn(function* ({ query, request }) {
            const scope = yield* restScope
            const { pageSize, backward, cursor, externalId } = yield* restPageOptions(
              query,
              "tenants",
              scope,
            )
            const page = yield* listTenants(scope, {
              pageSize,
              position: cursor,
              backward,
              externalId,
              includePrevious: true,
            })
              .pipe(
                Stream.runHead,
                Effect.map(Option.getOrThrow),
              )
            return yield* Effect.promise(() =>
              restPage(page, "tenants", scope, request.url, backward, externalId)
            )
          }, restHandleErrors("listTenants")),
          getTenant: Effect.fn(function* ({ params }) {
            return yield* getTenant(yield* restScope, params.id)
          }, restHandleErrors("getTenant")),
          createTenant: Effect.fn(function* ({ payload }) {
            const row = yield* createTenant(yield* restScope, payload)
            return HttpApiSchema.withHeaders({
              body: row,
              headers: { Location: `/api/v1/tenants/${row.id}` },
            })
          }, restHandleErrors("createTenant")),
          updateTenant: Effect.fn(function* ({ params, payload }) {
            return yield* updateTenant(yield* restScope, params.id, payload)
          }, restHandleErrors("updateTenant")),
        })
      }),
  )
}
