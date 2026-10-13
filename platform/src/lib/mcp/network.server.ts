import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici"
import { MCP_MAX_METADATA_BYTES, MCP_MAX_RESULT_BYTES } from "./schemas.ts"

const mcpBlockedAddresses = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["192.88.99.0", 24],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  mcpBlockedAddresses.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  mcpBlockedAddresses.addSubnet(network, prefix, "ipv6")

export function mcpAddressIsPublic(address: string): boolean {
  const family = isIP(address)
  return (
    family !== 0 &&
    (family !== 6 || /^2[0-9a-f]{3}:/i.test(address)) &&
    !mcpBlockedAddresses.check(address, family === 6 ? "ipv6" : "ipv4")
  )
}

export function mcpUrlIsPublic(url: URL): boolean {
  const hostname = url.hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase()
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    hostname !== "localhost" &&
    !hostname.endsWith(".localhost") &&
    (!isIP(hostname) || mcpAddressIsPublic(hostname))
  )
}

export function mcpHeadersAreAllowed(headers: Readonly<Record<string, string>>): boolean {
  if (
    new Set(Object.keys(headers).map((name) => name.toLowerCase())).size !==
    Object.keys(headers).length
  )
    return false
  return Object.entries(headers).every(
    ([name, value]) =>
      /^[!#$%&'*+.^`|~\w-]+$/.test(name) &&
      !/[\r\n\0]/.test(value) &&
      !/^(?:host|cookie|set-cookie|origin|referer|connection|content-length|content-type|accept|transfer-encoding|upgrade|expect|te|trailer|via|forwarded|proxy-.*|sec-.*|x-forwarded-.*|mcp-.*|x-mcp-.*)$/i.test(
        name,
      ),
  )
}

export async function mcpPublicAddresses(hostname: string) {
  const addresses = await lookup(hostname.replace(/^\[|\]$/g, ""), { all: true })
  if (!addresses.length || addresses.some(({ address }) => !mcpAddressIsPublic(address)))
    throw new TypeError("MCP endpoint must resolve only to public addresses")
  return addresses
}

export function mcpCreateDispatcher() {
  // Pin the validated resolution at the socket boundary, preserving TLS hostname verification.
  // https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md#parameter-connectoptions
  return new Agent({
    connect: {
      lookup(hostname, options, callback) {
        void mcpPublicAddresses(hostname).then(
          (addresses) =>
            options.all
              ? callback(null, addresses)
              : callback(null, addresses[0]!.address, addresses[0]!.family),
          () => callback(new Error("MCP endpoint resolution was refused"), "", 4),
        )
      },
    },
  })
}

export async function mcpBoundedResponse(response: Response, maximum: number): Promise<Response> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel()
    throw new TypeError("MCP response exceeds the size limit")
  }
  if (!response.body) return response
  const reader = response.body.getReader()
  let received = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          controller.close()
          return
        }
        received += next.value.byteLength
        if (received > maximum) {
          await reader.cancel()
          controller.error(new TypeError("MCP response exceeds the size limit"))
          return
        }
        controller.enqueue(next.value)
      } catch {
        controller.error(new TypeError("MCP response could not be read"))
      }
    },
    cancel: (reason) => reader.cancel(reason),
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export async function mcpGuardedFetch(
  dispatcher: Agent,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : input)
  if (!mcpUrlIsPublic(url)) throw new TypeError("MCP endpoint must be public HTTPS")
  const request = input instanceof Request ? input : undefined
  const options = {
    ...init,
    ...(request
      ? {
          method: init?.method ?? request.method,
          headers: init?.headers ?? request.headers,
          body:
            init?.body ??
            (request.method === "GET" || request.method === "HEAD" ? undefined : request.body),
          signal: init?.signal ?? request.signal,
        }
      : {}),
    dispatcher,
    redirect: "error",
    ...(init?.body instanceof ReadableStream || request?.body ? { duplex: "half" } : {}),
  }
  const response = await undiciFetch(url, options as UndiciRequestInit)
  const maximum =
    new Headers(init?.headers ?? request?.headers).get("Mcp-Method") === "tools/call"
      ? MCP_MAX_RESULT_BYTES
      : MCP_MAX_METADATA_BYTES
  return mcpBoundedResponse(response as unknown as Response, maximum)
}
