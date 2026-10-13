import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import ipaddr from "ipaddr.js"
import { Agent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici"
import { MCP_MAX_METADATA_BYTES, MCP_MAX_RESULT_BYTES } from "./schemas.ts"

export function mcpAddressIsPublic(address: string): boolean {
  return (
    isIP(address) !== 0 &&
    (!address.includes(":") || /^2[0-9a-f]{3}:/i.test(address)) &&
    ipaddr.parse(address).range() === "unicast"
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
  let received = 0
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength
        if (received > maximum) throw new TypeError("MCP response exceeds the size limit")
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(body, response)
}

export async function mcpGuardedFetch(
  dispatcher: Agent,
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (!mcpUrlIsPublic(url)) throw new TypeError("MCP endpoint must be public HTTPS")
  const options = {
    ...init,
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    dispatcher,
    redirect: "error",
    duplex: "half",
  }
  const response = await undiciFetch(url, options as UndiciRequestInit)
  const maximum =
    request.headers.get("Mcp-Method") === "tools/call"
      ? MCP_MAX_RESULT_BYTES
      : MCP_MAX_METADATA_BYTES
  return mcpBoundedResponse(response as unknown as Response, maximum)
}
