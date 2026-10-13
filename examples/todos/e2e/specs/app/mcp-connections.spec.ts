import { captureMoment } from "../../capture.ts"
import { expect, test } from "../../fixtures.ts"
import { mcpConnections } from "../../pages/mcp-connections.ts"
import { mintSeedChatAuthToken } from "../../tokens.ts"
import { platformUrl, seedTarget } from "../../worktree.ts"

test("personal MCP accounts use real scoped APIs and never return credentials", async ({
  page,
  chat,
  request,
}) => {
  await chat.waitForReady()
  const headers = { "x-api-key": seedTarget.apiKey }
  const created = await request.post(`${platformUrl}/api/v1/mcp/servers`, {
    headers,
    data: {
      name: "Personal integration",
      endpoint_url: "https://mcp.example.test/mcp",
      enabled: true,
      default_connection_scope: "tenant_user",
      auth_config: { kind: "static_headers", header_names: ["Authorization", "X-Api-Key"] },
    },
  })
  expect(created.status()).toBe(200)
  const server = (await created.json()) as { id: string; lock_version: number }
  const connections = mcpConnections(page)
  try {
    await connections.open()
    await expect(connections.accountForm).toHaveCount(0)
    await connections.addAccount()
    await connections.accountForm
      .getByLabel("Account name", { exact: true })
      .fill("Work integration")
    await connections.accountForm
      .getByRole("combobox", { name: "Server", exact: true })
      .selectOption(server.id)
    await connections.accountForm
      .getByLabel("Authorization value")
      .fill("Bearer personal-browser-secret")
    await connections.accountForm.getByLabel("X-Api-Key value").fill("personal-browser-key")
    await connections.accountForm.getByRole("button", { name: "Save account", exact: true }).click()
    const account = connections.account("Work integration")
    await expect(account).toContainText("Connected")
    await expect(account).toContainText("Personal")
    await account.getByRole("button", { name: "Edit account", exact: true }).click()
    const editForm = connections.panel
      .locator("form")
      .filter({ has: page.getByRole("heading", { name: "Edit account", exact: true }) })
    await expect(editForm.getByLabel("Authorization value")).toHaveValue("")
    await expect(editForm.getByLabel("X-Api-Key value")).toHaveValue("")
    await editForm.getByLabel("Authorization value").fill("Bearer incomplete-replacement")
    await editForm.getByRole("button", { name: "Save account", exact: true }).click()
    await expect(editForm.getByRole("alert")).toContainText("Enter every header value")
    await editForm.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(account).toContainText("Connected")
    const token = await mintSeedChatAuthToken(seedTarget.apiKey)
    const catalog = await request.get(`${platformUrl}/api/v1/me/mcp/catalog`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(catalog.status()).toBe(200)
    const safe = (await catalog.json()) as { connections: { id: string }[] }
    expect(JSON.stringify(safe)).not.toContain("personal-browser-secret")
    const connection = safe.connections.find((entry) => entry.id)!
    const impersonated = await request.get(
      `${platformUrl}/api/v1/me/mcp/connections/${connection.id}`,
      { headers },
    )
    expect(impersonated.status()).toBe(403)
    await captureMoment(page, "mcp-personal-account-without-host-query-provider")
    await page.setViewportSize({ width: 390, height: 844 })
    await captureMoment(page, "mcp-personal-mobile-management")
    await account.getByRole("button", { name: "Disconnect locally" }).click()
    await expect(account).toContainText("Not connected")
    await account.getByRole("button", { name: "Delete account", exact: true }).click()
    await connections.panel.getByRole("button", { name: "Cancel", exact: true }).click()
    await expect(account).toBeVisible()
    await account.getByRole("button", { name: "Delete account", exact: true }).click()
    await connections.panel.getByRole("button", { name: "Delete account", exact: true }).click()
    await expect(connections.notice).toContainText("Account deleted")
    await expect(account).toHaveCount(0)
  } finally {
    const deleted = await request.delete(
      `${platformUrl}/api/v1/mcp/servers/${server.id}?lock_version=${server.lock_version}`,
      { headers },
    )
    expect(deleted.status()).toBe(204)
  }
})

test("disabled custom-server permission keeps accounts visible but removes new-account choices", async ({
  page,
  chat,
  request,
}) => {
  await chat.waitForReady()
  const adminHeaders = { "x-api-key": seedTarget.apiKey }
  const policyUrl = `${platformUrl}/api/v1/mcp/policy`
  const policyResponse = await request.get(policyUrl, { headers: adminHeaders })
  expect(policyResponse.status()).toBe(200)
  const original = (await policyResponse.json()) as {
    allow_tenant_mcp_servers: boolean
    allow_tenant_user_mcp_servers: boolean
    lock_version: number
  }
  const allowed = await request.patch(policyUrl, {
    headers: adminHeaders,
    data: { ...original, allow_tenant_user_mcp_servers: true },
  })
  expect(allowed.status()).toBe(200)
  const enabled = (await allowed.json()) as typeof original
  const token = await mintSeedChatAuthToken(seedTarget.apiKey)
  const personalHeaders = { authorization: `Bearer ${token}` }
  const created = await request.post(`${platformUrl}/api/v1/me/mcp/servers`, {
    headers: personalHeaders,
    data: {
      name: "Custom personal server",
      endpoint_url: "https://mcp.example.test/custom",
      enabled: true,
      default_connection_scope: "tenant_user",
      auth_config: { kind: "none" },
    },
  })
  expect(created.status()).toBe(200)
  const server = (await created.json()) as { id: string; lock_version: number }
  const connections = mcpConnections(page)
  try {
    await connections.open()
    await connections.addAccount()
    await connections.accountForm.getByLabel("Account name", { exact: true }).fill("Custom account")
    await connections.accountForm.getByRole("button", { name: "Save account", exact: true }).click()
    await expect(connections.account("Custom account")).toContainText("Connected")
    const denied = await request.patch(policyUrl, {
      headers: adminHeaders,
      data: { ...enabled, allow_tenant_user_mcp_servers: false },
    })
    expect(denied.status()).toBe(200)
    await page.reload()
    await chat.waitForReady()
    await connections.open()
    const account = connections.account("Custom account")
    await expect(account).toContainText("Blocked by organization")
    await expect(account.getByRole("button", { name: "Delete account", exact: true })).toBeEnabled()
    await expect(
      account.getByRole("button", { name: "Test connection", exact: true }),
    ).toBeDisabled()
    await expect(
      connections.panel.getByRole("button", { name: "Add account", exact: true }),
    ).toBeDisabled()
  } finally {
    const deleted = await request.delete(
      `${platformUrl}/api/v1/me/mcp/servers/${server.id}?lock_version=${server.lock_version}`,
      { headers: personalHeaders },
    )
    expect(deleted.status()).toBe(204)
    const currentResponse = await request.get(policyUrl, { headers: adminHeaders })
    const current = (await currentResponse.json()) as typeof original
    const restored = await request.patch(policyUrl, {
      headers: adminHeaders,
      data: { ...original, lock_version: current.lock_version },
    })
    expect(restored.status()).toBe(200)
  }
})
