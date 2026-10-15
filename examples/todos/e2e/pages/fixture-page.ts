import type { Page } from "@playwright/test"

export async function openBrowserFixture(page: Page, fixture: URL) {
  const fixturePath = fixture.pathname.slice(new URL("../../", import.meta.url).pathname.length)
  await page.route("**/*", (route) =>
    route.request().resourceType() === "script" ? route.abort() : route.continue(),
  )
  await page.goto("/")
  await page.unroute("**/*")
  await page.setContent(
    `<html><title>SDK host fixture</title><div id="fixture-root"></div><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true; await import("/${fixturePath}");</script></html>`,
  )
}
