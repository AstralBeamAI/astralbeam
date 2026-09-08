import { Context, Schema, SchemaGetter } from "effect"
import { HttpApiMiddleware, HttpApiSchema } from "effect/unstable/httpapi"
import type { EffectDatabase } from "@/db"
import type { TenantScope } from "../../../../db/tenant.server.ts"
import { TenantExternalIdSchema } from "../../../../api/management.ts"
export const restEmptyPage = { items: [], page_after: null, page_before: null }
export const restResourceSecurity = {
  security: [{ OrganizationApiKey: [] }, { astralBeamToken: [] }],
}
export const restExamplePageCursors = {
  page_after:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6InBhZ2luYXRpb24randzIn0.eyJ2IjoxLCJpZCI6IjAxOWVlZDY4LWZkMDAifQ.demo-signature",
  page_before: null,
}
export const tenantRestKeys = {
  externalId: "external_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const
const restStrictOptions = { parseOptions: { onExcessProperty: "error" as const } }
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
})
const restErrorSchemas = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map((status) =>
  HttpApiSchema.WithHeaders(RestApiErrorSchema, {
    "Retry-After": Schema.optionalKey(Schema.String),
    "WWW-Authenticate": Schema.optionalKey(Schema.String),
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
export class ApiBoundary extends HttpApiMiddleware.Service<ApiBoundary>()(
  "ApiBoundary",
  { error: restErrorSchemas },
) {}

export class RestAuthorization extends HttpApiMiddleware.Service<
  RestAuthorization,
  { provides: RestScope; requires: EffectDatabase }
>()("RestAuthorization") {}

const restPageCursor = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))
export const restPageQuery = Schema.Struct({
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
export const restPageFields = {
  page_after: Schema.NullOr(Schema.String).annotate({
    description: "Pass as page_after to fetch the next page; null means no next page.",
  }),
  page_before: Schema.NullOr(Schema.String).annotate({
    description: "Pass as page_before to fetch the previous page; null means no previous page.",
  }),
}
export const restPageHeaders = { Link: Schema.optionalKey(Schema.String) }
