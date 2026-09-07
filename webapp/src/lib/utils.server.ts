// The reverse proxy terminates TLS on this host over loopback and nothing else sits in front, so a
// forwarded header only means anything when the connection it arrived on came from that proxy.
export const LOOPBACK_PROXY_ADDRESSES: readonly string[] = ["127.0.0.1", "::1"]

// A dual-stack listener can report an IPv4 peer in the IPv4-mapped form.
// https://docs.deno.com/api/deno/~/Deno.NetAddr
const IPV4_MAPPED_LOOPBACK_ADDRESS = "::ffff:127.0.0.1"

/** Whether the request's own peer is the loopback reverse proxy rather than a remote caller. */
export function isLoopbackProxyAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  return LOOPBACK_PROXY_ADDRESSES.includes(address) ||
    address === IPV4_MAPPED_LOOPBACK_ADDRESS
}
