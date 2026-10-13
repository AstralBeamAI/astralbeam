import { expect, type Locator, type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"
import {
  SEED_DOGFOOD,
  SEED_PASSWORD,
  SEED_TODOS_TARGET,
} from "../../../../platform/scripts/seed/fixtures.ts"
import { platformUrl } from "../worktree.ts"

const waitForHydration = (control: Locator) =>
  expect
    .poll(
      () => control.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__react"))),
      {
        timeout: 60_000,
      },
    )
    .toBe(true)

export async function prepareMcpDefinition(page: Page, endpoint: string) {
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
  await waitForHydration(dashboard.getByRole("button", { name: "Add server", exact: true }))
  await dashboard.getByRole("button", { name: "Add server", exact: true }).click()
  const dialog = dashboard.getByRole("dialog")
  await dialog.getByLabel("Public HTTPS endpoint").fill(endpoint)
  await dialog.getByLabel("Authentication", { exact: true }).selectOption("static_headers")
  await dialog.getByLabel("Header names, comma separated").fill("Authorization, X-Api-Key")
  await dialog.getByRole("button", { name: "Add server", exact: true }).click()
  const server = dashboard.locator("article").filter({
    has: dashboard.getByRole("heading", { name: new URL(endpoint).hostname, exact: true }),
  })
  await expect(server).toBeVisible()
  return async () => {
    await server.getByRole("button", { name: "Remove server", exact: true }).click()
    await dashboard
      .getByRole("alertdialog")
      .getByRole("button", { name: "Remove server", exact: true })
      .click()
    await expect(server).toHaveCount(0)
    await dashboard.close()
  }
}
export function mcpConnections(page: Page) {
  const root = page.locator("aside.chat-sidebar")
  return {
    async hideHeader() {
      await page.route("**/__mcp-sdk/*.js", (route) =>
        route.fulfill({
          path: fileURLToPath(
            new URL(
              `../../../../sdk/dist/${new URL(route.request().url()).pathname.split("/").pop()}`,
              import.meta.url,
            ),
          ),
          contentType: "text/javascript",
        }),
      )
      await page.setContent(`<aside class="chat-sidebar" style="height:700px"></aside>
        <script type="module">
          import { mountAstralBeamChat } from '/__mcp-sdk/client.js';
          mountAstralBeamChat(document.querySelector('aside'), {
            apiUrl: ${JSON.stringify(`${platformUrl}/api`)}, showHeader: false,
            fetchAstralBeamToken: { url: '/api/astralbeam/token' }
          });
        </script>`)
    },
    async open() {
      await root.getByRole("button", { name: "Connections", exact: true }).click()
      await expect(root.getByRole("heading", { name: "Connections", exact: true })).toBeVisible()
    },
    account(host: string) {
      return root
        .locator('[data-slot="mcp-account"]')
        .filter({ has: page.getByRole("heading", { name: host, exact: true }) })
    },
    notice: root.locator('[data-slot="mcp-notice"]'),
    panel: root,
  }
}
