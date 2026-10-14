import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { mcpConnections, prepareMcpDefinition } from "../../pages/mcp-connections.ts"
import { mintSeedChatAuthToken } from "../../tokens.ts"
import { platformUrl, seedTarget } from "../../worktree.ts"

test("private MCP accounts connect, replace and clear credentials without returning secrets", async ({
  page,
  chat,
  request,
}) => {
  await chat.waitForReady()
  const endpoint = `https://private-${crypto.randomUUID()}.example.test/mcp`
  const cleanup = await prepareMcpDefinition(page, endpoint)
  const connections = mcpConnections(page)
  try {
    await connections.open()
    const account = connections.account(new URL(endpoint).hostname)
    await account.getByRole("button", { name: /^Add credentials:/ }).click()
    await account.getByLabel("Authorization value").fill("Bearer personal-browser-secret")
    await account.getByLabel("X-Api-Key value").fill("personal-browser-key")
    await account.getByRole("button", { name: "Save credentials", exact: true }).click()
    await expect(account).toContainText("Connected")
    await account.getByRole("button", { name: /^Replace credentials:/ }).click()
    await expect(account.getByLabel("Authorization value")).toHaveValue("")
    await expect(account.getByLabel("X-Api-Key value")).toHaveValue("")
    await account.getByRole("button", { name: "Cancel", exact: true }).click()
    const token = await mintSeedChatAuthToken(seedTarget.apiKey)
    const catalog = await request.get(`${platformUrl}/api/v1/me/mcp/catalog`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(catalog.status()).toBe(200)
    const safe = await catalog.text()
    expect(safe).not.toContain("personal-browser-secret")
    expect(safe).not.toContain("personal-browser-key")
    const denied = await request.get(`${platformUrl}/api/v1/me/mcp/catalog`, {
      headers: { "x-api-key": seedTarget.apiKey },
    })
    expect(denied.status()).toBe(401)
    await captureMoment(page, "mcp-private-credentials")
    await page.setViewportSize({ width: 390, height: 844 })
    await captureMoment(page, "mcp-private-mobile")
    await account.getByRole("button", { name: /^Disconnect:/ }).click()
    await expect(account).toContainText("Not connected")
    await expect(connections.notice).toContainText("Disconnected locally")
    await expect(account.getByRole("button", { name: /^Disconnect:/ })).toHaveCount(0)
    await connections.hideHeader()
    await connections.open()
    await expect(account.getByRole("button", { name: /^Add credentials:/ })).toBeVisible()
  } finally {
    await cleanup()
  }
})
