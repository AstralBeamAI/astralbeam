import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { mcpConnections, prepareMcpDefinition } from "../../pages/mcp-connections.ts"
import { mintSeedChatAuthToken } from "../../tokens.ts"
import { platformUrl, seedTarget } from "../../worktree.ts"

test("private MCP connections connect, replace and clear credentials without returning secrets", async ({
  page,
  chat,
  request,
}) => {
  // Dashboard sign-in, server provisioning and widget recovery share the test's timeout.
  // https://playwright.dev/docs/test-timeouts#test-timeout
  test.setTimeout(90_000)
  await chat.waitForReady()
  const endpoint = `https://private-${crypto.randomUUID()}.example.test/mcp`
  const cleanup = await prepareMcpDefinition(page, endpoint)
  const connections = mcpConnections(page)
  try {
    await connections.open()
    const connection = connections.connection(new URL(endpoint).hostname)
    await connection.getByRole("button", { name: /^Connect:/ }).click()
    await connection.getByLabel("Authorization value").fill("Bearer personal-browser-secret")
    await connection.getByLabel("X-Api-Key value").fill("personal-browser-key")
    await connection.getByRole("button", { name: "Save credentials", exact: true }).click()
    await expect(connection).toContainText("Connected")
    await connection.getByRole("button", { name: /^Replace credentials:/ }).click()
    await expect(connection.getByLabel("Authorization value")).toHaveValue("")
    await expect(connection.getByLabel("X-Api-Key value")).toHaveValue("")
    await connection.getByRole("button", { name: "Cancel", exact: true }).click()
    const token = await mintSeedChatAuthToken(seedTarget.apiKey)
    const catalog = await request.get(`${platformUrl}/api/v1/me/mcp/catalog`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(catalog.status()).toBe(200)
    const safe = await catalog.text()
    expect(safe).not.toContain("personal-browser-secret")
    expect(safe).not.toContain("personal-browser-key")
    const refreshed = page.waitForResponse("**/api/v1/me/mcp/catalog")
    await connection.getByRole("button", { name: /^Test connection:/ }).click()
    await refreshed
    await expect(connections.notice).toContainText("The MCP server is unavailable")
    await captureMoment(page, "mcp-private-credentials")
    await page.setViewportSize({ width: 390, height: 844 })
    await captureMoment(page, "mcp-private-mobile")
    await page.route("**/api/v1/me/mcp/catalog", (route) => route.abort(), { times: 1 })
    await connection.getByRole("button", { name: /^Disconnect:/ }).click()
    await expect(connection).toHaveCount(0)
    await connections.panel.getByRole("button", { name: "Try again", exact: true }).click()
    await expect(connection).toContainText("Not connected")
    await expect(connections.notice).toContainText("Disconnected locally")
    await expect(connection.getByRole("button", { name: /^Disconnect:/ })).toHaveCount(0)
  } finally {
    await cleanup()
  }
})

test("pre-registered OAuth servers require a trusted HTTPS issuer", async ({ page, chat }) => {
  await chat.waitForReady()
  const endpoint = `https://registered-${crypto.randomUUID()}.example.test/mcp`
  const cleanup = await prepareMcpDefinition(page, endpoint, "https://issuer.example.test/oauth")
  try {
    const connections = mcpConnections(page)
    await connections.open()
    await expect(connections.connection(new URL(endpoint).hostname)).toContainText("Not connected")
  } finally {
    await cleanup()
  }
})
