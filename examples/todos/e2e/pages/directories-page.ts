import { type Page } from "@playwright/test"
import { fileURLToPath } from "node:url"
import { platformUrl } from "../worktree.ts"

export function directoriesPage(page: Page) {
  const tenants = page.getByRole("region", { name: "Tenants", exact: true })
  const users = page.getByRole("region", { name: /^(Users|Tenant users)$/ })
  return {
    tenants,
    users,
    userTable: users.locator('[data-slot="directory-table"]'),
    error: page.getByRole("alert").filter({ hasText: "Directory error:" }),
    dismissError: page.getByRole("button", { name: "Dismiss error" }),
    retry: users.getByRole("button", { name: "Retry", exact: true }),
    refresh: users.getByRole("button", { name: "Refresh directory", exact: true }),
    next: tenants.getByRole("button", { name: "Next", exact: true }),
    previous: tenants.getByRole("button", { name: "Previous", exact: true }),
    reset: page.getByRole("button", { name: "Reset", exact: true }),
    refreshMounted: page.locator("#refresh"),
    unmount: page.getByRole("button", { name: "Unmount", exact: true }),
    remount: page.getByRole("button", { name: "Remount", exact: true }),
    clearTenant: users.getByRole("button", { name: "Clear selection" }),
    clearCount: page.locator("#clear-count"),
    theme: page.getByRole("button", { name: /^Theme:/ }),
    customTheme: page.getByRole("button", { name: /^Custom theme:/ }),
    open: () => page.goto("/tenant-users"),
    selectTenant: async (name: string) => {
      await users.getByRole("combobox", { name: "Tenant", exact: true }).fill(name)
      await users.getByRole("option", { name: new RegExp(name) }).click()
    },
    showAdmin: page.getByRole("checkbox", { name: "Show stored admin fields" }),
    tenantContext: users.locator("header p"),
    tenantOption: (name: string) => users.getByRole("option", { name: new RegExp(name) }),
    tenant: (name: string) => tenants.getByText(name, { exact: true }),
    user: (name: string) => users.getByText(name, { exact: true }),
    selectAdmin: (label: string) =>
      users.getByRole("combobox", { name: "Stored admin status" }).selectOption({ label }),
    adminFilter: users.getByRole("combobox", { name: "Stored admin status" }),
    metadata: users.getByRole("cell").filter({ has: page.locator("dl") }),
    tenantPicker: users.getByRole("combobox", { name: "Tenant", exact: true }),
  }
}

export async function openVanillaDirectories(
  page: Page,
  options: { scope?: "tenant" | "organization"; tenantExternalId?: string } = {},
  kinds: ("tenants" | "users" | "threads")[] = ["tenants", "users"],
) {
  await page.route("**/__listing-sdk/*.js", (route) =>
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
  await page.route("**/*", (route) =>
    route.request().resourceType() === "script" ? route.abort() : route.continue(),
  )
  await page.goto("/")
  await page.unroute("**/*")
  await page.setContent(`<!doctype html><html lang="en"><title>Vanilla directories</title>
        <button id="reset">Reset</button><button id="refresh">Refresh mounts</button>
        <button id="unmount">Unmount</button><button id="remount">Remount</button>
        <output id="clear-count">0</output><div id="tenants"></div><div id="users"></div><div id="threads"></div>
        <script type="module">
          import { mountAstralBeamTenantList, mountAstralBeamTenantUserList, mountAstralBeamThreadList } from '/__listing-sdk/client.js';
          const options = { apiUrl: ${JSON.stringify(
            `${platformUrl}/api`,
          )}, fetchAstralBeamToken: { url: '/__listing-token' }, ...${JSON.stringify(options)},
            onTenantChange: (tenant) => {
              if (tenant) return;
              const output = document.getElementById('clear-count');
              output.textContent = String(Number(output.textContent) + 1);
            },
          };
          const mounts = { tenants: mountAstralBeamTenantList, users: mountAstralBeamTenantUserList, threads: mountAstralBeamThreadList };
          const mount = () => ${JSON.stringify(kinds)}.map(kind => mounts[kind](document.getElementById(kind), options));
          let handles = mount();
          document.getElementById('reset').onclick = () => handles.forEach(handle => handle.reset());
          document.getElementById('refresh').onclick = () => handles.forEach(handle => handle.refresh());
          document.getElementById('unmount').onclick = () => { handles.forEach(handle => handle.unmount()); handles = []; };
          document.getElementById('remount').onclick = () => { handles.forEach(handle => handle.unmount()); handles = mount(); };
        </script></html>`)
}
