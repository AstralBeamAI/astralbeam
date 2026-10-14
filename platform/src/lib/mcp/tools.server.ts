import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import {
  StreamableHTTPClientTransport,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/client"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv"
import { createMCPClient } from "@tanstack/ai-mcp"
import type { AnyServerTool, ToolExecutionContext } from "@tanstack/ai"
import { Context, Effect, Layer, Redacted } from "effect"
import { McpConnections } from "./mcp.server.ts"
import { McpAuthorization } from "./authorization.server.ts"
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
} from "./schemas.ts"
import { McpUnavailable } from "./errors.ts"
import { mcpCreateDispatcher, mcpGuardedFetch } from "./network.server.ts"

const mcpRuntimeMethods = new Set(["server/discover", "tools/list", "tools/call"])
function mcpToolAlias(connectionId: string, nativeName: string): string {
  return `mcp_${connectionId.replaceAll("-", "")}_${createHash("sha256").update(nativeName).digest("hex").slice(0, 24)}`
}
type McpPresentation = typeof McpToolPresentationSchema.Type

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
    let pages = 0
    // Modern ai-mcp calls omit the HTTP signal, so carry it through the scoped fetch.
    // https://unpkg.com/@tanstack/ai-mcp@0.8.3/src/tools.ts
    const callSignals = new AsyncLocalStorage<AbortSignal>()
    const validator = new AjvJsonSchemaValidator()
    const transport = new StreamableHTTPClientTransport(new URL(server.endpointUrl), {
      protocolVersion: MCP_PROTOCOL_VERSION,
      onInsufficientScope: "throw",
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers)
        const method = headers.get("Mcp-Method") ?? ""
        const signal = callSignals.getStore()
        if (
          headers.get("MCP-Protocol-Version") !== MCP_PROTOCOL_VERSION ||
          !mcpRuntimeMethods.has(method) ||
          (method === "tools/list" && ++pages > MCP_MAX_DISCOVERY_PAGES)
        )
          throw new McpUnavailable()
        const credential = await readCredential()
        if (credential.kind === "static_headers")
          for (const [name, value] of Object.entries(credential.headers)) headers.set(name, value)
        if (credential.kind === "oauth") {
          lastToken = credential.tokens.access_token
          headers.set("Authorization", `Bearer ${lastToken}`)
        }
        return mcpGuardedFetch(dispatcher, url, {
          ...init,
          headers,
          signal: AbortSignal.any([
            AbortSignal.timeout(
              method === "tools/call" ? MCP_TOOL_TIMEOUT_MS : MCP_AUTH_TIMEOUT_MS,
            ),
            ...(signal ? [signal] : []),
            ...(init?.signal ? [init.signal] : []),
          ]),
        })
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
    const client = yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: (signal) =>
          callSignals.run(signal, () =>
            createMCPClient({
              transport,
              clientOptions: { capabilities: { elicitation: undefined, sampling: undefined } },
            }),
          ),
        catch: () => new McpUnavailable(),
      }),
      (opened) => Effect.promise(() => opened.close()),
    )
    const tools = yield* Effect.tryPromise({
      try: (signal) => callSignals.run(signal, () => client.tools()),
      catch: () => new McpUnavailable(),
    })
    const catalogBytes = new TextEncoder().encode(JSON.stringify(tools)).byteLength
    if (tools.length > MCP_MAX_TOOLS || catalogBytes > MCP_MAX_CATALOG_BYTES)
      return yield* new McpUnavailable()
    const presentation: McpPresentation[] = []
    const boundTools = yield* Effect.try({
      try: () =>
        tools.map((remote) => {
          const nativeToolName = remote.metadata.mcp.serverToolName
          const name = mcpToolAlias(connection.id, nativeToolName)
          const details = {
            name,
            title: `${new URL(server.endpointUrl).hostname}: ${remote.metadata.mcp.title}`,
            mcpServerId: server.id,
            connectionId: connection.id,
            nativeToolName,
          }
          const tool: AnyServerTool = {
            ...remote,
            name,
            inputSchema: fromJsonSchema(remote.inputSchema as JsonSchemaType, validator),
            ...(remote.outputSchema
              ? { outputSchema: fromJsonSchema(remote.outputSchema as JsonSchemaType, validator) }
              : {}),
            metadata: {
              source: "mcp",
              ...details,
              originalInputSchema: remote.inputSchema as JsonSchemaType,
            },
            execute: (args: unknown, context?: ToolExecutionContext) =>
              Effect.runPromise(
                Effect.tryPromise({
                  try: (signal) =>
                    callSignals.run(
                      context?.abortSignal
                        ? AbortSignal.any([signal, context.abortSignal])
                        : signal,
                      () => Promise.resolve(remote.execute!(args, context)),
                    ),
                  catch: () => new McpUnavailable(),
                }),
              ),
          }
          presentation.push(details)
          return tool
        }),
      catch: () => new McpUnavailable(),
    })
    return { catalogBytes, tools: boundTools, presentation }
  })
  const acquire = Effect.fn("McpTools.acquire")(function* (actor: McpActor) {
    const catalog = yield* connections.catalog(actor)
    const active = catalog.connections.filter((entry) => entry.authState === "connected")
    const pending = yield* Effect.forEach(
      active,
      (connection) =>
        openClient({ actor, reference: connection }).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        ),
      { concurrency: 4 },
    )
    const result = {
      tools: [] as AnyServerTool[],
      presentation: [] as McpPresentation[],
      unavailable: catalog.connections
        .filter((entry) => entry.authState === "reauthorization_required")
        .map((entry) => entry.id),
    }
    let catalogBytes = 0
    for (const [index, entry] of pending.entries()) {
      if (
        !entry ||
        result.tools.length + entry.tools.length > MCP_MAX_TOOLS ||
        catalogBytes + entry.catalogBytes > MCP_MAX_CATALOG_BYTES
      ) {
        result.unavailable.push(active[index]!.id)
        continue
      }
      catalogBytes += entry.catalogBytes
      result.tools.push(...entry.tools)
      result.presentation.push(...entry.presentation)
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
