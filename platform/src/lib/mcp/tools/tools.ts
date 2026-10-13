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
  MCP_MAX_CATALOG_BYTES,
  MCP_MAX_DISCOVERY_PAGES,
  MCP_MAX_TOOLS,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_TIMEOUT_MS,
  type McpActor,
  type McpReference,
  type McpToolPresentationSchema,
} from "../schemas.ts"
import { McpUnavailable } from "../errors.ts"
import { mcpCreateDispatcher, mcpGuardedFetch } from "../network.server.ts"

function mcpToolAlias(connectionId: string, nativeName: string): string {
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
    let lastToken: string | undefined
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
        if (credential.kind === "static_headers")
          for (const [name, value] of Object.entries(credential.headers)) headers.set(name, value)
        if (credential.kind === "oauth") {
          lastToken = credential.tokens.access_token
          headers.set("Authorization", `Bearer ${lastToken}`)
        }
        return mcpGuardedFetch(dispatcher, url, { ...init, headers })
      },
      ...(server.authConfig.kind === "oauth"
        ? {
            authProvider: {
              token: () => Promise.resolve(lastToken),
              onUnauthorized: async () => {
                await readCredential(lastToken)
              },
            },
          }
        : {}),
    })
    yield* Effect.addFinalizer(() => Effect.promise(() => client.close()))
    const { tools } = yield* Effect.tryPromise({
      try: async (signal) => {
        await client.connect(transport, { signal, timeout: MCP_AUTH_TIMEOUT_MS })
        return client.listTools({}, { signal, timeout: MCP_AUTH_TIMEOUT_MS })
      },
      catch: () => new McpUnavailable(),
    })
    const catalogBytes = new TextEncoder().encode(JSON.stringify(tools)).byteLength
    if (tools.length > MCP_MAX_TOOLS || catalogBytes > MCP_MAX_CATALOG_BYTES)
      return yield* new McpUnavailable()
    const catalog = yield* Effect.try({
      try: () => {
        const aliases = new Set<string>()
        return tools.map((remote) => {
          const name = mcpToolAlias(connection.id, remote.name)
          if (aliases.has(name)) throw new Error("MCP tool alias collision")
          aliases.add(name)
          const presentation = {
            name,
            title: `${new URL(server.endpointUrl).hostname}: ${remote.title ?? remote.name}`,
            mcpServerId: server.id,
            connectionId: connection.id,
            nativeToolName: remote.name,
          }
          const tool = toolDefinition({
            name,
            description: remote.description ?? presentation.title,
            inputSchema: fromJsonSchema(remote.inputSchema as JsonSchemaType, validator),
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
                  client.callTool(
                    { name: remote.name, arguments: args as Record<string, unknown> },
                    {
                      timeout: MCP_TOOL_TIMEOUT_MS,
                      ...(context?.abortSignal ? { signal: context.abortSignal } : {}),
                    },
                  ),
                catch: () => new McpUnavailable(),
              }).pipe(
                Effect.withSpan("McpTools.call", {
                  attributes: { connectionId: connection.id, mcpServerId: server.id },
                }),
              ),
            )
          })
          return { tool, presentation }
        })
      },
      catch: () => new McpUnavailable(),
    })
    return {
      catalogBytes,
      tools: catalog.map((entry) => entry.tool),
      presentation: catalog.map((entry) => entry.presentation),
      unavailable: [],
    }
  })
  const acquire = Effect.fn("McpTools.acquire")(function* (actor: McpActor) {
    const catalog = yield* connections.catalog(actor)
    const active = catalog.connections.filter((entry) => entry.authState === "connected")
    const pending = yield* Effect.forEach(
      active,
      (connection) =>
        openClient({ actor, reference: connection }).pipe(
          Effect.catch(() =>
            Effect.succeed({
              catalogBytes: 0,
              tools: [],
              presentation: [],
              unavailable: [connection.id],
            }),
          ),
        ),
      { concurrency: 4 },
    )
    const result: McpToolSet = {
      tools: [],
      presentation: [],
      unavailable: catalog.connections
        .filter((entry) => entry.authState === "reauthorization_required")
        .map((entry) => entry.id),
    }
    let catalogBytes = 0
    for (const [index, entry] of pending.entries()) {
      if (
        result.tools.length + entry.tools.length > MCP_MAX_TOOLS ||
        catalogBytes + entry.catalogBytes > MCP_MAX_CATALOG_BYTES
      ) {
        result.unavailable.push(active[index]!.id)
        continue
      }
      catalogBytes += entry.catalogBytes
      result.tools.push(...entry.tools)
      result.presentation.push(...entry.presentation)
      result.unavailable.push(...entry.unavailable)
    }
    return result
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
