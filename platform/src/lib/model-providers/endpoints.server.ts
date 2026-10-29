import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"
import { fetchWithTraceContext } from "@/lib/runtime/tracing-context.server"

// Non-public IANA ranges, including cloud metadata and address-translation destinations.
// https://www.iana.org/assignments/iana-ipv4-special-registry
const privateModelEndpointRanges = new BlockList()
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  privateModelEndpointRanges.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  // https://www.iana.org/assignments/ipv6-unicast-address-assignments
  ["2d00::", 8],
  ["2e00::", 7],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const)
  privateModelEndpointRanges.addSubnet(network, prefix, "ipv6")

/** IPv4-mapped IPv6 addresses match their IPv4 range. Non-addresses are not private. */
export function isPrivateModelEndpointAddress(address: string): boolean {
  const family = isIP(address)
  return family !== 0 && privateModelEndpointRanges.check(address, family === 6 ? "ipv6" : "ipv4")
}

/** Checks a URL without resolving it, so saves can refuse literal private hosts. */
export function isPublicModelEndpointUrl(url: URL): boolean {
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "")
  return (
    url.protocol === "https:" &&
    host !== "localhost" &&
    !host.endsWith(".localhost") &&
    !isPrivateModelEndpointAddress(host)
  )
}

// Refuses non-HTTPS URLs, private resolutions, and redirects. DNS may change before fetch's own
// lookup, but HTTPS then requires the rebound target to hold a certificate for the host.
export const fetchPublicModelEndpoint: (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response> = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  const addresses = isPublicModelEndpointUrl(url)
    ? await lookup(url.hostname.replace(/^\[(.*)\]$/, "$1"), { all: true })
    : []
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateModelEndpointAddress(address))
  )
    throw new TypeError("The model provider URL does not resolve to a public HTTPS endpoint")
  return fetchWithTraceContext(input, { ...init, redirect: "manual" })
}
