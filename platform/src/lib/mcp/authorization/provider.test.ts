import { describe, expect, test } from "vitest"
import { mcpDiscoveryBinding, mcpOAuthCredential } from "./provider.ts"
import type { OAuthDiscoveryState } from "@modelcontextprotocol/client"
const mcpTestDiscovery = {
  authorizationServerUrl: "https://issuer.example",
  authorizationServerMetadata: {
    issuer: "https://issuer.example",
    authorization_endpoint: "https://issuer.example/authorize",
    token_endpoint: "https://issuer.example/token",
    response_types_supported: ["code"],
  },
  resourceMetadata: {
    resource: "https://resource.example/mcp",
    authorization_servers: ["https://issuer.example"],
  },
} satisfies OAuthDiscoveryState
describe("MCP OAuth security binding", () => {
  test("requires exact discovery issuer and a resource belonging to this endpoint", () => {
    expect(mcpDiscoveryBinding(mcpTestDiscovery, "https://resource.example/mcp").issuer).toBe(
      "https://issuer.example",
    )
    expect(() =>
      mcpDiscoveryBinding(
        {
          ...mcpTestDiscovery,
          authorizationServerMetadata: {
            ...mcpTestDiscovery.authorizationServerMetadata,
            issuer: "https://other.example",
          },
        },
        "https://resource.example/mcp",
      ),
    ).toThrow()
    expect(() =>
      mcpDiscoveryBinding(
        {
          ...mcpTestDiscovery,
          resourceMetadata: {
            ...mcpTestDiscovery.resourceMetadata,
            resource: "https://other.example/mcp",
          },
        },
        "https://resource.example/mcp",
      ),
    ).toThrow()
    expect(() =>
      mcpDiscoveryBinding(mcpTestDiscovery, "https://resource.example/different"),
    ).toThrow()
    expect(() =>
      mcpOAuthCredential({
        discovery: mcpTestDiscovery,
        clientInformation: {},
        serverUrl: "https://resource.example/mcp",
        now: 0,
        tokens: { issuer: "https://other.example", access_token: "bad", token_type: "Bearer" },
      }),
    ).toThrow()
  })
})
