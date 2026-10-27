import { expect, type Locator, type Page } from "@playwright/test"
import {
  SEED_DOGFOOD,
  SEED_PASSWORD,
  SEED_TODOS_TARGET,
} from "../../../../platform/scripts/seed/fixtures.ts"
import { platformUrl } from "../worktree.ts"
import { captureMoment } from "../capture.ts"

const waitForHydration = (control: Locator) =>
  expect
    .poll(
      () => control.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__react"))),
      {
        timeout: 60_000,
      },
    )
    .toBe(true)

export async function prepareMcpDefinition(page: Page, endpoint: string, issuer?: string) {
  const dashboard = await page.context().newPage()
  await dashboard.goto(`${platformUrl}/auth/sign-in`)
  await waitForHydration(dashboard.locator("#password"))
  await dashboard.locator("#email").fill(SEED_DOGFOOD.ownerEmail)
  await dashboard.locator("#password").fill(SEED_PASSWORD)
  await expect(dashboard.getByRole("button", { name: /^sign in$/i })).toBeEnabled({
    timeout: 30_000,
  })
  await dashboard.getByRole("button", { name: /^sign in$/i }).click()
  await dashboard.waitForURL((url) => !url.pathname.startsWith("/auth/"))
  await dashboard.goto(`${platformUrl}/${SEED_TODOS_TARGET.organizationSlug}/mcp`)
  await waitForHydration(dashboard.getByRole("button", { name: "Add MCP server", exact: true }))
  await dashboard.getByRole("button", { name: "Add MCP server", exact: true }).click()
  const form = dashboard.getByRole("form", { name: "Add MCP server", exact: true })
  await form.getByLabel("Server URL").fill(endpoint)
  await form
    .getByRole("combobox", { name: "Authentication", exact: true })
    .selectOption(issuer ? "oauth" : "static_headers")
  if (issuer) {
    await form.getByRole("combobox", { name: "OAuth setup", exact: true }).selectOption("manual")
    const issuerField = form.getByLabel("Authorization server issuer", { exact: true })
    await expect(issuerField).toHaveAttribute("required", "")
    await form.getByLabel("Client ID", { exact: true }).fill("pre-registered-browser-client")
    await issuerField.fill("http://issuer.example.test")
    await form.getByRole("button", { name: "Add MCP server", exact: true }).click()
    await expect(issuerField).toHaveAttribute("aria-invalid", "true")
    await captureMoment(dashboard, "pre-registered-oauth-insecure-issuer-refused")
    await issuerField.fill(issuer)
  } else {
    await form.getByLabel("Header names, comma separated").fill("Authorization, X-Api-Key")
  }
  await form.getByRole("button", { name: "Add MCP server", exact: true }).click()
  const server = dashboard.locator("article").filter({
    has: dashboard.getByRole("heading", { name: new URL(endpoint).hostname, exact: true }),
  })
  await expect(server).toBeVisible()
  if (issuer) await captureMoment(dashboard, "pre-registered-oauth-issuer-configured")
  return async () => {
    await server
      .getByRole("button", { name: `Remove server: ${new URL(endpoint).hostname}`, exact: true })
      .click()
    await dashboard
      .getByRole("group", { name: "Remove server?", exact: true })
      .getByRole("button", { name: "Remove server", exact: true })
      .click()
    await expect(server).toHaveCount(0)
    await dashboard.close()
  }
}
export function mcpConnections(page: Page) {
  const root = page.locator("aside.chat-sidebar")
  return {
    async open() {
      await root.getByRole("button", { name: "MCP connections", exact: true }).click()
      await expect(
        root.getByRole("heading", { name: "MCP connections", exact: true }),
      ).toBeVisible()
    },
    connection(host: string) {
      return root
        .locator('[data-slot="mcp-connection"]')
        .filter({ has: page.getByRole("heading", { name: host, exact: true }) })
    },
    notice: root.locator('[data-slot="mcp-notice"]'),
    panel: root,
  }
}
