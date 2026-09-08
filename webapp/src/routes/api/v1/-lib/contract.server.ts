import { HttpApi, OpenApi } from "effect/unstable/httpapi"
import { APP_NAME } from "../../../../lib/constants.ts"
import { ApiBoundary, RestAuthorization } from "./shared.server"
import { chatApi } from "../chat/-lib/chat.server"
import { tenantApi } from "./tenant.server"
import { tenantUserApi } from "./tenant-user.server"

export const ApiV1 = HttpApi.make("ApiV1").add(
  tenantApi.middleware(RestAuthorization),
  tenantUserApi.middleware(RestAuthorization),
  chatApi,
)
  .prefix("/api/v1").middleware(ApiBoundary).annotate(OpenApi.Title, `${APP_NAME} API`)
  .annotate(OpenApi.Version, "1.0.0").annotate(OpenApi.Transform, customizeOpenApi)

function customizeOpenApi(document: Record<string, unknown>): Record<string, unknown> {
  const api = document as unknown as OpenApi.OpenAPISpec
  for (const methods of Object.values(api.paths)) {
    for (const operation of Object.values(methods)) {
      if (Array.isArray(operation)) continue
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
      description: "Chat JWT. Tenant resource APIs also accept a full organization API key here.",
    },
    organizationToken: {
      type: "http",
      scheme: "bearer",
      description:
        "Organization-management JWT. Current database roles apply: owners/developers read and write Tenant resources, viewers read only. Does not authenticate chat or dashboard administration.",
    },
    ArtifactTicket: {
      type: "apiKey",
      in: "query",
      name: "ticket",
      description:
        "Short-lived signed download ticket returned by a chat artifact. No bearer token required.",
    },
  }
  return document
}
