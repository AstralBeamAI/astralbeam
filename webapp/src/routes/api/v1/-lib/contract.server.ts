import { Context, Schema, SchemaGetter } from "effect"
import type { EffectDatabase } from "@/db"
import type { TenantScope } from "../../../../db/tenant.server.ts"
import {
  TenantExternalIdSchema,
  TenantPatchSchema,
  TenantRecordSchema as ManagementTenantRecordSchema,
  TenantUserPatchSchema,
  TenantUserRecordSchema as ManagementTenantUserRecordSchema,
  TenantUserWriteSchema,
  TenantWriteSchema,
} from "../../../../api/management.ts"
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi"
import { UuidV7Schema } from "../../../../lib/schemas.ts"
import { APP_NAME } from "../../../../lib/constants.ts"

const restExampleTenant = {
  id: "019eed68-fd00-7c42-9a61-53b3a890d276",
  external_id: "customer-42",
  name: "Acme Logistics",
  metadata: { plan: "pro", region: "eu-west-1" },
  created_at: "2026-06-22T09:30:00.000Z",
  updated_at: "2026-06-22T09:30:00.000Z",
}
const restExampleUser = {
  ...restExampleTenant,
  id: "019eed6a-d1c0-7543-b892-608cb6e174da",
  external_id: "user-7",
  name: "Alex Morgan",
  metadata: { role: "dispatcher", department: "operations" },
  tenant_id: restExampleTenant.id,
  admin: false,
}
const restEmptyPage = { items: [], start_cursor: null, end_cursor: null, has_next_page: false }
const restExamplePageCursors = {
  start_cursor:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6InBhZ2luYXRpb24randzIn0.eyJ2IjoxLCJpZCI6IjAxOWVlZDY4LWZkMDAifQ.demo-signature",
  end_cursor:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6InBhZ2luYXRpb24randzIn0.eyJ2IjoxLCJpZCI6IjAxOWVlZDY4LWZkMDAifQ.demo-signature",
  has_next_page: false,
}
const tenantRestKeys = {
  externalId: "external_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const
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
const restStrictOptions = { parseOptions: { onExcessProperty: "error" as const } }
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
const UpdateTenantSchema = TenantPatchSchema.annotate({ identifier: "UpdateTenantInput" }).pipe(
  Schema.annotateEncoded({
    examples: [{ metadata: { plan: "enterprise", region: "eu-west-1" } }, {
      name: null,
      metadata: {},
    }],
  }),
)
const UpdateTenantUserSchema = TenantUserPatchSchema.annotate({
  identifier: "UpdateTenantUserInput",
}).pipe(
  Schema.annotateEncoded({
    examples: [{ name: "Alex Morgan-Smith" }, { name: null, metadata: {} }],
  }),
)

export const RestApiErrorSchema = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: Schema.Int,
  detail: Schema.String,
  issues: Schema.optionalKey(
    Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
  ),
}).annotate({
  identifier: "AstralBeamApiError",
  examples: [
    {
      type: "about:blank",
      status: 409,
      title: "Conflict",
      detail: "The external ID already exists in this scope.",
    },
    {
      type: "about:blank",
      status: 422,
      title: "Unprocessable Content",
      detail: "Invalid request body.",
      issues: [{ path: "body.name", message: "Value does not match the API schema." }],
    },
  ],
})
const restErrorSchemas = [400, 401, 403, 404, 409, 415, 422, 429, 500, 503].map((status) =>
  HttpApiSchema.WithHeaders(RestApiErrorSchema, {
    "Retry-After": Schema.optionalKey(Schema.String),
  })
    .pipe(
      HttpApiSchema.status(status),
      HttpApiSchema.asJson({ contentType: "application/problem+json" }),
    )
)
export interface RestScope extends TenantScope {
  externalTenantId?: string
  tenantFilter?: string
}
export const restScope = Context.Service<RestScope>("RestScope")
// Framework-required middleware class; authentication runs once before request decoding.
export class RestBoundary extends HttpApiMiddleware.Service<
  RestBoundary,
  { provides: RestScope; requires: EffectDatabase }
>()("RestBoundary", { error: restErrorSchemas }) {}

const restPageCursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
const restPageQuery = Schema.Struct({
  "filter[external_id]": Schema.optionalKey(TenantExternalIdSchema.annotate({
    description:
      "Exact, case-sensitive external ID; whitespace is preserved. Returns zero or one item.",
  })),
  page_size: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^0*[1-9]\d*$/)).pipe(
      Schema.decodeTo(Schema.Number, {
        decode: SchemaGetter.transform((value) => Math.min(Number(value), 100)),
        encode: SchemaGetter.transform<string, number>(String),
      }),
    ),
  ),
  page_after: Schema.optionalKey(restPageCursor),
  page_before: Schema.optionalKey(restPageCursor),
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
).annotate(restStrictOptions)
export type RestPageQuery = typeof restPageQuery.Type
const restPageFields = {
  start_cursor: Schema.NullOr(Schema.String),
  end_cursor: Schema.NullOr(Schema.String),
  has_next_page: Schema.optionalKey(Schema.Boolean),
  has_previous_page: Schema.optionalKey(Schema.Boolean),
}
export const tenantRestPage = Schema.Struct({
  items: Schema.Array(TenantRecordSchema),
  ...restPageFields,
})
  .pipe(Schema.annotateEncoded({
    identifier: "TenantPage",
    examples: [{ items: [restExampleTenant], ...restExamplePageCursors }, restEmptyPage],
    description:
      "Live keyset page. Forward requests include has_next_page; backward requests include has_previous_page. Cursors identify items, not availability.",
  }))
export const tenantUserRestPage = Schema.Struct({
  items: Schema.Array(TenantUserRecordSchema),
  ...restPageFields,
}).pipe(Schema.annotateEncoded({
  identifier: "TenantUserPage",
  examples: [{ items: [restExampleUser], ...restExamplePageCursors }, restEmptyPage],
  description:
    "Live keyset page ordered by tenant_id, id. Only the requested direction's availability is guaranteed.",
}))
const restPageHeaders = { Link: Schema.optionalKey(Schema.String) }
const restMemberParams = { id: UuidV7Schema.annotate({ examples: [restExampleTenant.id] }) }
const restUserParams = {
  tenant_id: restMemberParams.id,
  id: UuidV7Schema.annotate({ examples: [restExampleUser.id] }),
}

export const TenantRestApi = HttpApi.make("TenantRestApi").add(
  HttpApiGroup.make("tenants", { topLevel: true }).annotate(OpenApi.Override, {
    "x-displayName": "Tenants",
  }).add(
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
      "Get a Tenant by internal UUIDv7, not external_id.",
    ),
    HttpApiEndpoint.patch("updateTenant", "/tenants/:id", {
      params: restMemberParams,
      payload: UpdateTenantSchema,
      success: TenantRecordSchema,
    }).annotate(OpenApi.Summary, "Update a Tenant").annotate(
      OpenApi.Description,
      "Update supplied name/metadata fields only. Requires an organization API key. name:null clears the name; metadata replaces the object. Last-write-wins; no upsert.",
    ),
  ).annotate(
    OpenApi.Description,
    "A Tenant is one of your Organization's customers. Use internal UUIDv7 IDs in resource paths and your own customer identity as external_id. External IDs are unique within the organization. Creation returns 201 and Location; reads and updates return 200. PATCH changes only supplied fields. IDs, external IDs, ownership, and timestamps are immutable. Updates use last-write-wins. Responses never expose organization_id; timestamps are ISO-8601 strings. These APIs neither issue tokens nor upsert identities. See [Errors](/docs/api#description/errors) for shared error handling.",
  ),
  HttpApiGroup.make("tenant_users", { topLevel: true }).annotate(OpenApi.Override, {
    "x-displayName": "TenantUsers",
  }).add(
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
    "A TenantUser is a user of one of your Organization's Tenants, not an employee using the dashboard. All routes use internal UUIDv7 tenant_id and user id values. External IDs are unique within the organization and Tenant; the same external user ID may exist in another Tenant. Creation returns 201 and Location; reads and updates return 200. PATCH changes only supplied fields. IDs, external IDs, ownership, and timestamps are immutable; users cannot move between Tenants. Updates use last-write-wins. Responses never expose organization_id; timestamps are ISO-8601 strings. Stored admin does not change signed JWT authority. Creation does not issue tokens or upsert identities. See [Errors](/docs/api#description/errors) for shared error handling.",
  ),
).prefix("/api/v1").middleware(RestBoundary).annotate(OpenApi.Title, `${APP_NAME} API`)
  .annotate(OpenApi.Version, "1.0.0").annotate(OpenApi.Transform, managementOpenApi)

function managementOpenApi(document: Record<string, unknown>): Record<string, unknown> {
  const api = document as unknown as OpenApi.OpenAPISpec
  for (const methods of Object.values(api.paths)) {
    for (const operation of Object.values(methods)) {
      if (Array.isArray(operation)) continue
      operation.security = [{ OrganizationApiKey: [] }, { Bearer: [] }]
      for (const parameter of operation.parameters ?? []) {
        if (parameter.in === "query" && parameter.name === "page_size") {
          // Effect string-tree codecs expose their serialization; HTTP tooling needs the logical numeric type.
          parameter.schema = {
            type: "integer",
            minimum: 1,
            default: 20,
            description:
              "Positive integer, default 20. Values above 100 are accepted and capped. page_after and page_before are mutually exclusive.",
          }
        }
      }
    }
  }
  api.components.securitySchemes = {
    OrganizationApiKey: {
      type: "apiKey",
      in: "header",
      name: "X-API-Key",
      description: "Full decorated organization API key.",
    },
    Bearer: {
      type: "http",
      scheme: "bearer",
      description: "Full decorated organization API key or chat JWT.",
    },
  }
  return document
}
