import { createHash } from "node:crypto"
import { AsyncLocalStorage } from "node:async_hooks"
import {
  StreamableHTTPClientTransport,
  fromJsonSchema,
  type JsonSchemaType,
} from "@modelcontextprotocol/client"
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv"
import { createMCPClient, MCPConnectionError } from "@tanstack/ai-mcp"
import type { AnyServerTool, ToolExecutionContext } from "@tanstack/ai"
import { Context, Effect, Layer, Redacted } from "effect"
import { McpConnections } from "./mcp.server.ts"
import { McpAuthorization } from "./authorization.server.ts"
import {
  McpUnavailable,
  McpUnsupportedProtocol,
  MCP_AUTH_TIMEOUT_MS,
  MCP_MAX_CONNECTIONS,
  MCP_MAX_DISCOVERY_PAGES,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_TIMEOUT_MS,
  type McpActor,
  type McpReference,
} from "./schemas.ts"
import { mcpCreateDispatcher, mcpGuardedFetch } from "./network.server.ts"

const mcpRuntimeMethods = new Set(["server/discover", "tools/list", "tools/call"])
function mcpToolAlias(connectionId: string, nativeName: string): string {
  return `mcp_${connectionId.replaceAll("-", "")}_${createHash("sha256").update(nativeName).digest("hex").slice(0, 24)}`
}

// Work around ai-mcp bypassing SDK header validation, mirroring and cancellation.
// https://github.com/TanStack/ai/issues/1794
function mcpHeaderPaths(
  schema: unknown,
  path: string[] | null = [],
  headers = new Map<string, string[]>(),
): Map<string, string[]> | undefined {
  if (!schema || typeof schema !== "object") return headers
  const node = schema as Record<string, unknown>
  const name = node["x-mcp-header"]
  if (name !== undefined) {
    if (
      !path?.length ||
      typeof name !== "string" ||
      !/^[!#$%&'*+\-.^`|~\w]+$/.test(name) ||
      typeof node.type !== "string" ||
      !["string", "integer", "boolean"].includes(node.type) ||
      headers.has(name.toLowerCase())
    )
      return undefined
    headers.set(name.toLowerCase(), path)
  }
  for (const [keyword, value] of Object.entries(node)) {
    if (!value || typeof value !== "object") continue
    if (
      [
        "properties",
        "patternProperties",
        "dependentSchemas",
        "dependencies",
        "$defs",
        "definitions",
      ].includes(keyword)
    ) {
      for (const [key, child] of Object.entries(value))
        if (
          !mcpHeaderPaths(child, keyword === "properties" && path ? [...path, key] : null, headers)
        )
          return undefined
    } else if (
      [
        "items",
        "additionalItems",
        "prefixItems",
        "contains",
        "additionalProperties",
        "unevaluatedProperties",
        "unevaluatedItems",
        "propertyNames",
        "oneOf",
        "anyOf",
        "allOf",
        "not",
        "if",
        "then",
        "else",
        "contentSchema",
      ].includes(keyword)
    ) {
      for (const child of Array.isArray(value) ? value : [value])
        if (!mcpHeaderPaths(child, null, headers)) return undefined
    }
  }
  return headers
}

function mcpInputHeaders(paths: Map<string, string[]>, args: unknown): Headers {
  const headers = new Headers()
  for (const [name, path] of paths) {
    const value = path.reduce<unknown>(
      (current, key) =>
        current && typeof current === "object" && Object.hasOwn(current, key)
          ? (current as Record<string, unknown>)[key]
          : undefined,
      args,
    )
    if (value != null) {
      if (
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isSafeInteger(value))
      )
        throw new McpUnavailable()
      const text = String(value)
      headers.set(
        `Mcp-Param-${name}`,
        /^[\t\u0020-\u007e]+$/.test(text) &&
          text === text.trim() &&
          !/^=\?base64\?.*\?=$/.test(text)
          ? text
          : `=?base64?${Buffer.from(text).toString("base64")}?=`,
      )
    }
  }
  return headers
}

const makeMcpTools = Effect.gen(function* () {
  const connections = yield* McpConnections
  const authorization = yield* McpAuthorization
  const openClient = Effect.fnUntraced(
    function* (input: { actor: McpActor; reference: McpReference }) {
      const { connection, server } = yield* connections.getConnection(input)
      const dispatcher = yield* Effect.acquireRelease(Effect.sync(mcpCreateDispatcher), (agent) =>
        Effect.promise(() => agent.close()),
      )
      const credentialInput = { ...input, expectedVersion: connection.lockVersion }
      const callSignals = new AsyncLocalStorage<{
        signal: AbortSignal | undefined
        headers?: Headers
      }>()
      const readCredential = (rejectedToken?: string) =>
        Effect.runPromise(authorization.getCredential({ ...credentialInput, rejectedToken }), {
          signal: callSignals.getStore()?.signal,
        }).then(Redacted.value)
      let lastToken: string | undefined
      let pages = 0
      const validator = new AjvJsonSchemaValidator()
      const transport = new StreamableHTTPClientTransport(new URL(server.endpointUrl), {
        protocolVersion: MCP_PROTOCOL_VERSION,
        onInsufficientScope: "throw",
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers)
          const method = headers.get("Mcp-Method") ?? ""
          const signal = callSignals.getStore()?.signal
          if (headers.get("MCP-Protocol-Version") !== MCP_PROTOCOL_VERSION || !method)
            throw new McpUnsupportedProtocol()
          if (
            !mcpRuntimeMethods.has(method) ||
            (method === "tools/list" && pages >= MCP_MAX_DISCOVERY_PAGES)
          )
            throw new McpUnavailable()
          if (method === "tools/call")
            for (const [name, value] of callSignals.getStore()?.headers ?? [])
              headers.set(name, value)
          const credential = await readCredential()
          if (credential.kind === "static_headers")
            for (const [name, value] of Object.entries(credential.headers)) headers.set(name, value)
          if (credential.kind === "oauth") {
            lastToken = credential.tokens.access_token
            headers.set("Authorization", `Bearer ${lastToken}`)
          }
          const response = await mcpGuardedFetch(dispatcher, url, {
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
          if (method === "tools/list" && response.ok) pages++
          return response
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
            callSignals.run({ signal }, () =>
              createMCPClient({
                transport,
                clientOptions: { capabilities: { elicitation: undefined, sampling: undefined } },
              }),
            ),
          catch: (error) =>
            error instanceof MCPConnectionError && error.cause instanceof McpUnsupportedProtocol
              ? error.cause
              : new McpUnavailable(),
        }),
        (opened) => Effect.promise(() => opened.close()),
      )
      const tools = yield* Effect.tryPromise({
        try: (signal) => callSignals.run({ signal }, () => client.tools()),
        catch: () => new McpUnavailable(),
      }).pipe(Effect.onError(() => Effect.promise(() => client.close())))
      return yield* Effect.try({
        try: () =>
          tools.flatMap((remote) => {
            const headers = mcpHeaderPaths(remote.inputSchema)
            if (!headers) return []
            const nativeToolName = remote.metadata.mcp.serverToolName
            const name = mcpToolAlias(connection.id, nativeToolName)
            const details = {
              name,
              title: `${new URL(server.endpointUrl).hostname}: ${remote.metadata.mcp.title}`,
              mcpServerId: server.id,
              connectionId: connection.id,
              nativeToolName,
            }
            const tool = {
              ...remote,
              name,
              description: `MCP server: ${server.endpointUrl}\n${remote.description}`,
              inputSchema: fromJsonSchema(remote.inputSchema as JsonSchemaType, validator),
              ...(remote.outputSchema
                ? {
                    outputSchema: fromJsonSchema(remote.outputSchema as JsonSchemaType, validator),
                  }
                : {}),
              metadata: {
                source: "mcp",
                ...details,
                originalInputSchema: remote.inputSchema as JsonSchemaType,
              },
              execute: async (args: unknown, context?: ToolExecutionContext) => {
                try {
                  return await callSignals.run(
                    {
                      signal: context?.abortSignal,
                      headers: mcpInputHeaders(headers, args),
                    },
                    () => remote.execute!(args, context),
                  )
                } catch {
                  throw new McpUnavailable()
                }
              },
            } satisfies AnyServerTool
            return [tool]
          }),
        catch: () => new McpUnavailable(),
      })
    },
    Effect.timeoutOrElse({
      duration: MCP_AUTH_TIMEOUT_MS,
      orElse: () => Effect.fail(new McpUnavailable()),
    }),
  )
  const acquire = Effect.fn("McpTools.acquire")(function* (actor: McpActor) {
    const catalog = yield* connections.catalog(actor)
    const active = catalog.connections.filter((entry) => entry.authState === "connected")
    const pending = yield* Effect.forEach(
      active.slice(0, MCP_MAX_CONNECTIONS),
      (connection) =>
        openClient({ actor, reference: connection }).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        ),
      { concurrency: 4 },
    )
    const tools = pending.flatMap((entry) => entry ?? [])
    return {
      tools,
      presentation: tools.map(({ name, metadata }) => ({ name, title: metadata.title })),
      unavailable: [
        ...catalog.connections.filter((entry) => entry.authState === "reauthorization_required"),
        ...active.filter((_entry, index) => !pending[index]),
      ].map((entry) => entry.id),
    }
  })
  const test = Effect.fn("McpTools.test")(function* (input: {
    actor: McpActor
    reference: McpReference
  }) {
    return yield* Effect.scoped(
      Effect.map(openClient(input), (opened) => ({ toolCount: opened.length })),
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
