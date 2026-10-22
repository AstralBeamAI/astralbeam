import type { OAuthDiscoveryState } from "@modelcontextprotocol/client"
import { Schema } from "effect"
import { expect, test } from "vitest"

import { McpDiscoverySchema } from "./schemas.ts"

const discovery: OAuthDiscoveryState = {
  authorizationServerUrl: "https://issuer.example",
  authorizationServerMetadata: {
    issuer: "https://issuer.example",
    authorization_endpoint: "https://issuer.example/authorize",
    token_endpoint: "https://issuer.example/token",
    response_types_supported: ["code"],
    jwks_uri: "https://issuer.example/keys",
    scopes_supported: ["read"],
    provider_extension: { enabled: true },
  },
  resourceMetadata: {
    resource: "https://mcp.example/mcp",
    authorization_servers: ["https://issuer.example"],
    provider_extension: ["retained"],
  },
  resourceMetadataUrl: "https://mcp.example/.well-known/oauth-protected-resource",
}

test("persisted discovery restores the SDK state without losing provider metadata", () => {
  const restored: OAuthDiscoveryState = Schema.decodeUnknownSync(McpDiscoverySchema)(
    JSON.parse(JSON.stringify(discovery)),
  )
  expect(restored).toEqual(discovery)
})

test.each([
  {},
  { ...discovery, authorizationServerUrl: null },
  { ...discovery, authorizationServerMetadata: { issuer: "https://issuer.example" } },
  { ...discovery, resourceMetadata: { resource: 12 } },
  {
    ...discovery,
    authorizationServerMetadata: {
      ...discovery.authorizationServerMetadata,
      response_types_supported: [12],
    },
  },
])("invalid persisted discovery is rejected before it reaches the OAuth SDK", (value) => {
  expect(() => Schema.decodeUnknownSync(McpDiscoverySchema)(value)).toThrow()
})
