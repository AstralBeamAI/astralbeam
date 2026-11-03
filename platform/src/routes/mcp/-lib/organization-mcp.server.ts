import {
  createMcpHandler,
  fromJsonSchema,
  McpServer,
  type CallToolResult,
  type JsonSchemaType,
} from "@modelcontextprotocol/server"
import { Context, Effect, Layer } from "effect"
import { HttpEffect, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { OpenApi } from "effect/http-api"

import { APP_NAME } from "@/lib/constants"
import { authenticateOrganizationApiKey } from "@/routes/api/v1/-lib/auth.server"
import { RestScope } from "@/routes/api/v1/-lib/shared.server"
import { annotateHttpRoute } from "@/lib/runtime/tracing-context.server"
import { ApiV1 } from "@/routes/api/v1/-lib/contract.server"

const organizationMcpSpec = OpenApi.fromApi(ApiV1, { referencePolicy: () => undefined })
const organizationMcpOperations = new Set([
  "searchDocumentation",
  "getOrganization",
  "listTenants",
  "getTenant",
  "createTenant",
  "updateTenant",
  "listUsersForTenant",
  "getTenantUser",
  "createTenantUser",
  "updateTenantUser",
  "getTenantUserUsage",
  "listThreads",
  "listThreadMessages",
])

interface OrganizationMcpArguments {
  params?: Record<string, string>
  query?: Record<string, string | number | boolean>
  body?: unknown
}

function organizationMcpInput(operation: OpenApi.OpenAPISpecOperation): JsonSchemaType {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const location of ["path", "query"] as const) {
    const parameters = operation.parameters.filter((parameter) => parameter.in === location)
    if (parameters.length === 0) continue
    const name = location === "path" ? "params" : "query"
    const requiredParameters = parameters.filter((parameter) => parameter.required)
    properties[name] = {
      type: "object",
      properties: Object.fromEntries(
        parameters.map((parameter) => [parameter.name, parameter.schema]),
      ),
      required: requiredParameters.map((parameter) => parameter.name),
      additionalProperties: false,
    }
    if (requiredParameters.length > 0) required.push(name)
  }
  if (operation.requestBody) {
    properties.body = operation.requestBody.content["application/json"]!.schema
    required.push("body")
  }
  return { type: "object", properties, required, additionalProperties: false } as JsonSchemaType
}

// Schemas and validation are immutable. Credentials and execution stay request-local.
const organizationMcpTools = Object.entries(organizationMcpSpec.paths).flatMap(([path, methods]) =>
  (["get", "post", "patch"] as const).flatMap((method) => {
    const operation = methods[method]
    if (!operation || !organizationMcpOperations.has(operation.operationId)) return []
    return [
      {
        path,
        method,
        operation,
        inputSchema: fromJsonSchema<OrganizationMcpArguments>(organizationMcpInput(operation)),
      },
    ]
  }),
)

function organizationMcpServer(input: {
  request: Request
  dispatch: (request: Request) => Promise<Response>
}) {
  const server = new McpServer(
    { name: APP_NAME, version: "1.0.0" },
    {
      capabilities: { tools: { listChanged: false } },
      instructions:
        "Call getOrganization first to confirm the organization. Use list operations to find records before creating them. Never guess UUIDs. Perform writes only when the user has authorized the intended changes.",
    },
  )
  const headers = new Headers({ "Content-Type": "application/json" })
  const requestId = input.request.headers.get("x-request-id")
  if (requestId) headers.set("X-Request-Id", requestId)
  for (const { path, method, operation, inputSchema } of organizationMcpTools) {
    server.registerTool(
      operation.operationId,
      {
        ...(operation.summary ? { title: operation.summary } : {}),
        ...(operation.description ? { description: operation.description } : {}),
        inputSchema,
        annotations: {
          readOnlyHint: method === "get",
          destructiveHint: method === "patch",
          idempotentHint: method !== "post",
          openWorldHint: false,
        },
      },
      async (args, context): Promise<CallToolResult> => {
        const pathname = path.replace(/\{([^}]+)\}/gu, (_match, name: string) =>
          encodeURIComponent(args.params![name]!),
        )
        const url = new URL(pathname, input.request.url)
        for (const [name, value] of Object.entries(args.query ?? {}))
          url.searchParams.set(name, String(value))
        const response = await input.dispatch(
          new Request(url, {
            method: method.toUpperCase(),
            headers,
            body: JSON.stringify(args.body),
            signal: AbortSignal.any([input.request.signal, context.mcpReq.signal]),
          }),
        )
        const content: CallToolResult["content"] = [{ type: "text", text: await response.text() }]
        const retryAfter = response.headers.get("retry-after")
        if (retryAfter) content.push({ type: "text", text: `Retry-After: ${retryAfter} seconds.` })
        return { content, isError: !response.ok }
      },
    )
  }
  return server
}

/** Uses the existing API router and its setup, error, and cache boundaries. */
export const organizationMcpRoutes = Layer.effectDiscard(
  Effect.gen(function* () {
    const router = yield* HttpRouter.HttpRouter
    yield* router.add(
      "*",
      "/mcp",
      Effect.gen(function* () {
        const native = yield* HttpServerRequest.HttpServerRequest
        const request = yield* HttpServerRequest.toWeb(native).pipe(Effect.orDie)
        annotateHttpRoute(request, "/mcp")
        // Organization API keys are server credentials, so browser-origin requests are rejected.
        if (request.headers.has("origin"))
          return HttpServerResponse.text("Forbidden", { status: 403 })
        const scope = yield* authenticateOrganizationApiKey(request)
        const context = Context.add(yield* Effect.context<never>(), RestScope, scope)
        const dispatch = HttpEffect.toWebHandler(router.asHttpEffect())
        const handler = createMcpHandler(
          () =>
            organizationMcpServer({
              request,
              dispatch: (toolRequest) => dispatch(toolRequest, context),
            }),
          { legacy: "reject" },
        )
        const response = yield* Effect.promise(() => handler.fetch(request)).pipe(
          Effect.ensuring(Effect.promise(() => handler.close())),
        )
        return HttpServerResponse.fromWeb(response)
      }),
    )
  }),
)
