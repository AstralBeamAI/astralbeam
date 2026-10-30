import { randomBytes } from "node:crypto"
import { validateHeaderName } from "node:http"

import { Result } from "effect"
import { IpInterface, IpNetwork, NetAddress } from "effect/net"

import type { ConfigValues } from "./config/types.ts"

export function generateSecret(): string {
  return randomBytes(32).toString("base64url")
}

export function parseClientIpHeaders(value: string): string[] {
  const headers = value
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean)
  if (headers.length === 0) {
    throw new Error("Use a comma-separated list of HTTP header names")
  }
  for (const header of headers) validateHeaderName(header)
  return headers
}

export function proxySettingsFromValues(values: ConfigValues) {
  const trustProxy = values.trust_proxy?.trim() || "false"
  const trustedProxies = ["true", "false"].includes(trustProxy)
    ? []
    : trustProxy
        .split(",")
        .map((address) => address.trim())
        .filter(Boolean)
  if (!["true", "false"].includes(trustProxy) && trustedProxies.length === 0) {
    throw new Error("Use true, false, or a comma-separated list of proxy IPs/CIDRs")
  }

  const addresses = trustedProxies.map((proxy) => {
    const parsed = IpInterface.fromStringUnsafe(proxy)
    if (NetAddress.isIpv6Address(parsed.address) && NetAddress.isIpv4Mapped(parsed.address)) {
      if (proxy.includes("/")) {
        throw new Error("Use IPv4 notation for mapped CIDRs in TRUST_PROXY")
      }
      return IpNetwork.fromAddressUnsafe(NetAddress.toCanonical(parsed.address), 32)
    }
    return IpNetwork.fromInterface(parsed)
  })
  return {
    trustProxy,
    trustedProxies,
    addresses,
    clientIpHeaders: parseClientIpHeaders(values.client_ip_headers ?? "x-forwarded-for"),
  }
}

/** Unrestricted ingress trust is opt-in. Otherwise verify the socket peer against the allowlist. */
export function isTrustedProxyAddress(
  address: string | undefined,
  settings = proxySettingsFromValues({}),
): boolean {
  if (settings.trustProxy === "true") return true
  if (settings.trustProxy === "false" || address === undefined) return false
  const parsed = NetAddress.ipFromString(address)
  if (Result.isFailure(parsed)) return false
  const ip = NetAddress.toCanonical(parsed.success)
  return settings.addresses.some((network) => IpNetwork.contains(network, ip))
}
