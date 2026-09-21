import { type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { webappUrl } from "../worktree.ts"

export function directoriesPage(page: Page) {
  const tenants = page.getByRole("region", { name: "Tenants", exact: true })
  const users = page.getByRole("region", { name: "Tenant users", exact: true })
  return {
    tenants,
    users,
    selection: page.getByRole("status").filter({ hasText: "Selected tenant:" }),
    error: page.getByRole("alert").filter({ hasText: "Directory error:" }),
    dismissError: page.getByRole("button", { name: "Dismiss error" }),
    retry: tenants.getByRole("button", { name: "Retry", exact: true }),
    next: tenants.getByRole("button", { name: "Next", exact: true }),
    previous: tenants.getByRole("button", { name: "Previous", exact: true }),
    reset: page.getByRole("button", { name: "Reset", exact: true }),
    unmount: page.getByRole("button", { name: "Unmount", exact: true }),
    remount: page.getByRole("button", { name: "Remount", exact: true }),
    clearTenant: users.getByRole("button", { name: "Clear tenant" }),
    theme: page.getByRole("button", { name: /^Theme:/ }),
    customTheme: page.getByRole("button", { name: /^Custom theme:/ }),
    popup: users.locator('[data-slot="combobox-content"]'),
    open: () => page.goto("/tenants"),
    openUsers: () => page.getByRole("link", { name: "Tenant users", exact: true }).click(),
    openExternal: (id: string) =>
      page.goto(`/tenant-users?tenantExternalId=${encodeURIComponent(id)}`),
    selectTenant: async (name: string) => {
      await users.getByRole("combobox", { name: "Tenant", exact: true }).fill(name)
      await users.getByRole("option", { name: new RegExp(name) }).click()
    },
    showAdmin: page.getByRole("checkbox", { name: "Show stored admin fields" }),
    tenantContext: users.locator("header p"),
    loadMore: users.getByRole("button", { name: "Load more tenants" }),
    tenantOption: (name: string) => users.getByRole("option", { name: new RegExp(name) }),
    tenant: (name: string) => tenants.getByRole("button", { name, exact: true }),
    user: (name: string) => users.getByRole("button", { name, exact: true }),
    adminFilter: users.getByRole("combobox", { name: "Stored admin status" }),
    metadata: users.locator("pre"),
    tenantPicker: users.getByRole("combobox", { name: "Tenant", exact: true }),
  }
}

export async function openVanillaDirectories(page: Page) {
  await page.route("**/__listing-sdk/*.js", (route) =>
    route.fulfill({
      path: fileURLToPath(
        new URL(
          `../../../../sdk/dist/${new URL(route.request().url()).pathname.split("/").pop()}`,
          import.meta.url,
        ),
      ),
      contentType: "text/javascript",
    }))
  await page.route(
    "**/*",
    (route) => route.request().resourceType() === "script" ? route.abort() : route.continue(),
  )
  await page.goto("/")
  await page.unroute("**/*")
  await page.setContent(`<!doctype html><html lang="en"><title>Vanilla directories</title>
        <button id="reset">Reset</button><button id="unmount">Unmount</button>
        <button id="remount">Remount</button><div id="tenants"></div><div id="users"></div>
        <script type="module">
          import { mountAstralBeamTenantList, mountAstralBeamTenantUserList } from '/__listing-sdk/client.js';
          const options = { apiUrl: ${
    JSON.stringify(`${webappUrl}/api`)
  }, fetchAstralBeamToken: { url: '/__listing-token' } };
          const mount = () => [
            mountAstralBeamTenantList(document.getElementById('tenants'), options),
            mountAstralBeamTenantUserList(document.getElementById('users'), options),
          ];
          let handles = mount();
          document.getElementById('reset').onclick = () => handles.forEach(handle => handle.reset());
          document.getElementById('unmount').onclick = () => { handles.forEach(handle => handle.unmount()); handles = []; };
          document.getElementById('remount').onclick = () => { handles.forEach(handle => handle.unmount()); handles = mount(); };
        </script></html>`)
}
