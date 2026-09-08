import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { APP_NAME } from "../../../../lib/constants.ts"
import { RestBoundary } from "./shared.server"
import { tenantApi } from "./tenant.server"
import { tenantUserApi } from "./tenant-user.server"

export const TenantRestApi = HttpApi.make("TenantRestApi").add(tenantApi, tenantUserApi)
  .prefix("/api/v1").middleware(RestBoundary).annotate(OpenApi.Title, `${APP_NAME} API`)
  .annotate(OpenApi.Version, "1.0.0").annotate(OpenApi.Transform, managementOpenApi)

function managementOpenApi(document: Record<string, unknown>): Record<string, unknown> {
  const api = document as unknown as OpenApi.OpenAPISpec
  for (const methods of Object.values(api.paths)) {
    for (const operation of Object.values(methods)) {
      if (Array.isArray(operation)) continue
      operation.security = [{ OrganizationApiKey: [] }, { astralBeamToken: [] }]
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
    astralBeamToken: {
      type: "http",
      scheme: "bearer",
      description: "Full decorated organization API key or chat JWT.",
    },
  }
  return document
}
