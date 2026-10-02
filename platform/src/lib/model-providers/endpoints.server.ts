import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

// Non-public IANA special-purpose ranges, including cloud metadata at 169.254.169.254.
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
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  privateModelEndpointRanges.addSubnet(network, prefix, "ipv4")
for (const [network, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
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
export const fetchPublicModelEndpoint: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input)
  const addresses = isPublicModelEndpointUrl(url)
    ? await lookup(url.hostname.replace(/^\[(.*)\]$/, "$1"), { all: true })
    : []
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateModelEndpointAddress(address))
  )
    throw new TypeError("The model provider URL does not resolve to a public HTTPS endpoint")
  return fetch(input, { ...init, redirect: "manual" })
}
