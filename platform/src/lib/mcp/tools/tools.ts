import { createHash } from "node:crypto"
import {
  Client,
  StreamableHTTPClientTransport,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/client"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv"
import { toolDefinition, type AnyServerTool } from "@tanstack/ai"
import { Context, Effect, Layer, Redacted } from "effect"
import { APP_NAME } from "@/lib/constants"
import { McpConnections } from "../mcp.server.ts"
import { McpAuthorization } from "../authorization/authorization.ts"
import {
  MCP_AUTH_TIMEOUT_MS,
  MCP_MAX_DISCOVERY_PAGES,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_TIMEOUT_MS,
  type McpActor,
  type McpReference,
  type McpToolPresentationSchema,
} from "../schemas.ts"
import { McpUnavailable } from "../errors.ts"
import { mcpCreateDispatcher, mcpGuardedFetch } from "../network.server.ts"

export function mcpToolAlias(connectionId: string, nativeName: string): string {
  return `mcp_${connectionId.replaceAll("-", "")}_${createHash("sha256").update(nativeName).digest("hex").slice(0, 24)}`
}
type McpPresentation = typeof McpToolPresentationSchema.Type
export interface McpToolSet {
  readonly tools: AnyServerTool[]
  readonly presentation: McpPresentation[]
  readonly unavailable: string[]
}

const makeMcpTools = Effect.gen(function* () {
  const connections = yield* McpConnections
  const authorization = yield* McpAuthorization
  const openClient = Effect.fnUntraced(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    const { connection, server } = yield* connections.getConnection(input)
    const dispatcher = yield* Effect.acquireRelease(Effect.sync(mcpCreateDispatcher), (agent) =>
      Effect.promise(() => agent.close()),
    )
    const credentialInput = { ...input, expectedVersion: connection.lockVersion }
    const readCredential = (rejectedToken?: string) =>
      Effect.runPromise(authorization.getCredential({ ...credentialInput, rejectedToken })).then(
        Redacted.value,
      )
    const initial = Redacted.value(yield* authorization.getCredential(credentialInput))
    const state = {
      lastToken: initial?.kind === "oauth" ? initial.tokens.access_token : undefined,
    }
    const validator = new AjvJsonSchemaValidator()
    const client = new Client(
      { name: APP_NAME, version: "1.0" },
      {
        capabilities: {},
        listMaxPages: MCP_MAX_DISCOVERY_PAGES,
        versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } },
        jsonSchemaValidator: validator,
      },
    )
    const transport = new StreamableHTTPClientTransport(new URL(server.endpointUrl), {
      protocolVersion: MCP_PROTOCOL_VERSION,
      reconnectionOptions: {
        maxRetries: 0,
        initialReconnectionDelay: 1000,
        maxReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1,
      },
      requestInit: { redirect: "error" },
      onInsufficientScope: "throw",
      fetch: async (url, init) => {
        const credential = await readCredential()
        const headers = new Headers(init?.headers)
        if (credential?.kind === "static_headers")
          for (const [name, value] of Object.entries(credential.headers)) headers.set(name, value)
        if (credential?.kind === "oauth") {
          state.lastToken = credential.tokens.access_token
          headers.set("Authorization", `Bearer ${state.lastToken}`)
        }
        return mcpGuardedFetch(dispatcher, url, { ...init, headers })
      },
      ...(server.authConfig.kind === "oauth"
        ? {
            authProvider: {
              token: async () => {
                const credential = await readCredential()
                state.lastToken =
                  credential?.kind === "oauth" ? credential.tokens.access_token : undefined
                return state.lastToken
              },
              onUnauthorized: async () => {
                await readCredential(state.lastToken)
              },
            },
          }
        : {}),
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()))
    yield* Effect.tryPromise({
      try: (signal) => client.connect(transport, { signal, timeout: MCP_AUTH_TIMEOUT_MS }),
      catch: () => new McpUnavailable(),
    })
    const { tools } = yield* Effect.tryPromise({
      try: (signal) => client.listTools({}, { signal, timeout: MCP_AUTH_TIMEOUT_MS }),
      catch: () => new McpUnavailable(),
    })
    const catalog = yield* Effect.try({
      try: () => {
        const aliases = new Set<string>()
        return tools.map((remote) => {
          const name = mcpToolAlias(connection.id, remote.name)
          if (aliases.has(name)) throw new Error("MCP tool alias collision")
          aliases.add(name)
          return {
            remote,
            name,
            inputSchema: fromJsonSchema(remote.inputSchema as JsonSchemaType, validator),
          }
        })
      },
      catch: () => new McpUnavailable(),
    })
    return { client, tools: catalog, server }
  })
  const acquire = Effect.fn("McpTools.acquire")(function* (actor: McpActor) {
    const catalog = yield* connections.catalog(actor)
    const pending = yield* Effect.forEach(
      catalog.connections.filter((entry) => entry.authState === "connected"),
      (connection) =>
        Effect.gen(function* () {
          const input = {
            actor,
            reference: {
              organizationId: connection.organizationId,
              tenantId: connection.tenantId,
              id: connection.id,
            },
          }
          return yield* openClient(input).pipe(
            Effect.flatMap((opened) =>
              Effect.try({
                try: () =>
                  opened.tools.map(({ remote, name, inputSchema }) => {
                    const presentation = {
                      name,
                      title: `${new URL(opened.server.endpointUrl).hostname}: ${remote.title ?? remote.name}`,
                      serverId: opened.server.id,
                      connectionId: connection.id,
                      nativeToolName: remote.name,
                    }
                    const definition = toolDefinition({
                      name,
                      description: remote.description ?? presentation.title,
                      inputSchema,
                      metadata: {
                        source: "mcp",
                        ...presentation,
                        originalInputSchema: remote.inputSchema,
                      },
                    }).server(async (args, context) => {
                      await Effect.runPromise(connections.getConnection(input))
                      // HTTP rejection can be retried by the SDK. Ambiguous business outcomes propagate unchanged.
                      // https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
                      return Effect.runPromise(
                        Effect.tryPromise({
                          try: () =>
                            opened.client.callTool(
                              { name: remote.name, arguments: args as Record<string, unknown> },
                              {
                                timeout: MCP_TOOL_TIMEOUT_MS,
                                ...(context?.abortSignal ? { signal: context.abortSignal } : {}),
                              },
                            ),
                          catch: () => new McpUnavailable(),
                        }).pipe(
                          Effect.withSpan("McpTools.call", {
                            attributes: { connectionId: connection.id, serverId: opened.server.id },
                          }),
                        ),
                      )
                    })
                    return { tool: definition, presentation }
                  }),
                catch: () => new McpUnavailable(),
              }),
            ),
            Effect.match({
              onFailure: (): McpToolSet => ({
                tools: [],
                presentation: [],
                unavailable: [connection.id],
              }),
              onSuccess: (tools): McpToolSet => ({
                tools: tools.map((entry) => entry.tool),
                presentation: tools.map((entry) => entry.presentation),
                unavailable: [],
              }),
            }),
          )
        }),
      { concurrency: 4 },
    )
    return {
      tools: pending.flatMap((entry) => entry.tools),
      presentation: pending.flatMap((entry) => entry.presentation),
      unavailable: pending.flatMap((entry) => entry.unavailable),
    }
  })
  const test = Effect.fn("McpTools.test")(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    return yield* Effect.scoped(
      Effect.map(openClient(input), (opened) => ({ toolCount: opened.tools.length })),
    )
  })
  return { acquire, test }
})

export class McpTools extends Context.Service<McpTools, Effect.Success<typeof makeMcpTools>>()(
  "astralbeam/mcp/tools/McpTools",
) {
  static readonly layerNoDeps = Layer.effect(McpTools, makeMcpTools)
  static readonly layer = McpTools.layerNoDeps.pipe(
    Layer.provide([McpConnections.layer, McpAuthorization.layer]),
  )
}
