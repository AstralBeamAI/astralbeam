import { NonEmptyStringSchema, enumSchema } from "../../../../lib/schemas.ts"
import { Context, Predicate, Schema, SchemaGetter } from "effect"
import { HttpServerResponse } from "effect/http"
import { HttpApiMiddleware, HttpApiSchema } from "effect/http-api"
import type { OrganizationCurrentUser } from "@/lib/auth/organization-token.server"
import type { TenantScope } from "@/lib/tenants/tenants.server"
import { APP_HANDLE } from "../../../../lib/constants.ts"
import { declaredHttpApiStatus } from "../../../../lib/runtime/http-api-status.ts"
import { TenantExternalIdSchema } from "../../../../lib/tenants/schemas.ts"
export const restEmptyPage = { items: [], page_after: null, page_before: null }
export const restResourceSecurity = {
  security: [{ OrganizationApiKey: [] }, { astralBeamToken: [] }, { organizationToken: [] }],
}
export const tenantRestKeys = {
  externalId: "external_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
} as const
export const RestApiErrorSchema = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: Schema.Int,
  detail: Schema.String,
  issues: Schema.optionalKey(
    Schema.Array(Schema.Struct({ path: Schema.String, message: Schema.String })),
  ),
  // An RFC 9457 extension member. https://www.rfc-editor.org/rfc/rfc9457#section-3.2
  reference: Schema.optionalKey(
    Schema.String.annotate({
      description: "Identifies the server log entry of an internal error. Quote it for support.",
    }),
  ),
}).annotate({
  identifier: "AstralBeamApiError",
})

/** A failure the REST boundary answers with its class's declared status and user-safe message. */
export interface RestError {
  readonly _tag: string
  readonly message: string
  readonly issues?: typeof RestApiErrorSchema.Type.issues
  readonly retryAfterSeconds?: number
  readonly reference?: string
}

/** A problem read back from the wire, which carries its status instead of declaring it. */
export class RestProblem extends Schema.TaggedError<RestProblem>()("RestProblem", {
  status: Schema.Int,
  message: Schema.String,
  issues: RestApiErrorSchema.fields.issues,
  retryAfterSeconds: Schema.optionalKey(Schema.Int),
  reference: Schema.optionalKey(Schema.String),
}) {}

export function restErrorStatus(error: unknown): number | undefined {
  return error instanceof RestProblem ? error.status : declaredHttpApiStatus(error)
}

const restErrorTitles: Record<number, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  413: "Content Too Large",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  503: "Service Unavailable",
}

const restProblemHeaders = {
  "Retry-After": Schema.optionalKey(Schema.String),
  "WWW-Authenticate": Schema.optionalKey(Schema.String),
}

/** The RFC 9457 body and headers of a failure, for HttpApi codecs and router-level replies. */
function restProblem(error: RestError) {
  const status = restErrorStatus(error) ?? 500
  const body: typeof RestApiErrorSchema.Type = {
    type: "about:blank",
    title: restErrorTitles[status] ?? "Request Failed",
    status,
    detail: error.message,
    ...(error.issues ? { issues: error.issues } : {}),
    ...(error.reference ? { reference: error.reference } : {}),
  }
  const headers: { "Retry-After"?: string; "WWW-Authenticate"?: string } = {
    ...(status === 401 ? { "WWW-Authenticate": `Bearer realm="${APP_HANDLE}"` } : {}),
    ...(error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {}),
  }
  return { body, headers }
}

export function restProblemResponse(error: RestError): HttpServerResponse.HttpServerResponse {
  const { body, headers } = restProblem(error)
  return HttpServerResponse.jsonUnsafe(body, {
    status: body.status,
    headers,
    contentType: "application/problem+json",
  })
}

export function isRestError(error: unknown): error is RestError {
  return (
    restErrorStatus(error) !== undefined &&
    Predicate.hasProperty(error, "message") &&
    Predicate.isString(error.message)
  )
}

// One codec per documented status keeps a single AstralBeamApiError response per status.
const restErrorSchemas = [400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503].map((status) =>
  Schema.declare(
    (error): error is RestError => isRestError(error) && restErrorStatus(error) === status,
  ).pipe(
    HttpApiSchema.encodeToWithHeaders(
      {
        // Each status annotates its own suspension, so OpenAPI still emits one shared component.
        body: Schema.suspend(() => RestApiErrorSchema).pipe(
          HttpApiSchema.status(status),
          HttpApiSchema.asJson({ contentType: "application/problem+json" }),
        ),
        headers: restProblemHeaders,
      },
      {
        decode: ({ body, headers }) =>
          new RestProblem({
            status: body.status,
            message: body.detail,
            ...(body.issues ? { issues: body.issues } : {}),
            ...(body.reference ? { reference: body.reference } : {}),
            ...(headers["Retry-After"]
              ? { retryAfterSeconds: Number(headers["Retry-After"]) }
              : {}),
          }),
        encode: restProblem,
      },
    ),
    // A suspended body has no identifier to name the response after.
    (codec) => codec.annotate({ description: "AstralBeamApiError" }),
  ),
)

export class RestScope extends Context.Service<
  RestScope,
  TenantScope & {
    readonly currentUser?: OrganizationCurrentUser | undefined
    readonly externalTenantId?: string | undefined
    readonly tenantFilter?: string | undefined
  }
>()("astralbeam/api/v1/RestScope") {}

/** Owns request checks and turns every failure into a declared problem response. */
export class ApiBoundary extends HttpApiMiddleware.Service<ApiBoundary>()(
  "astralbeam/api/v1/ApiBoundary",
  { error: restErrorSchemas },
) {}

export class RestAuthorization extends HttpApiMiddleware.Service<
  RestAuthorization,
  { provides: RestScope }
>()("astralbeam/api/v1/RestAuthorization", { error: restErrorSchemas }) {}

const restPageCursor = NonEmptyStringSchema.check(Schema.isMaxLength(2048))
export const restPageQuery = Schema.Struct({
  q: Schema.optionalKey(
    Schema.String.check(
      Schema.isMaxLength(255),
      Schema.makeFilter((value) => !value.includes("\0"), {
        message: "Search must not contain NUL characters.",
        toJsonSchema: () => ({ pattern: "^[^\\u0000]*$" }),
      }),
    ).annotate({
      description:
        "Case-insensitive literal substring of name or external_id. Trimmed, blank means no search.",
    }),
  ),
  "filter[external_id]": Schema.optionalKey(
    TenantExternalIdSchema.annotate({
      description:
        "Exact, case-sensitive external ID; whitespace is preserved. Returns zero or one item.",
    }),
  ),
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
)
export type RestPageQuery = typeof restPageQuery.Type
export const restPaginationQuery = Schema.Struct({
  page_size: restPageQuery.fields.page_size,
  page_after: restPageQuery.fields.page_after,
  page_before: restPageQuery.fields.page_before,
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
export const restUserPageQuery = Schema.Struct({
  ...restPageQuery.fields,
  "filter[admin]": Schema.optionalKey(enumSchema(["true", "false"])),
}).check(
  Schema.makeFilter((query) => query.page_after === undefined || query.page_before === undefined),
)
export const restPageFields = {
  page_after: Schema.NullOr(Schema.String).annotate({
    description: "Pass as page_after to fetch the next page; null means no next page.",
  }),
  page_before: Schema.NullOr(Schema.String).annotate({
    description: "Pass as page_before to fetch the previous page; null means no previous page.",
  }),
}
export const restPageHeaders = { Link: Schema.optionalKey(Schema.String) }
