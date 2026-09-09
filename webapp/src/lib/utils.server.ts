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

/** The deployment's public origin, for the absolute URLs crawlers require. */
export async function resolveAppOrigin(request: Request): Promise<string> {
  const { getGlobalConfig } = await import("@/lib/config")
  // A crawler reads robots.txt before setup stores a base URL and while the database holding it is
  // unreachable, and treats a 5xx there as disallow-all, so the request's origin is the fallback.
  const appBaseUrl = await getGlobalConfig("app_base_url").catch(() => undefined)
  return appBaseUrl ?? new URL(request.url).origin
}
