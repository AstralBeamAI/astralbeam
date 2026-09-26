import { expect, test } from "@playwright/test"

const acme = "8f25a5c7-28cc-49d4-b4c6-21c20a781d01"
const orbit = "8f25a5c7-28cc-49d4-b4c6-21c20a781d02"
const sso = "74dcb815-bc71-4f65-a100-000000000100"

test("issue pages persist, support history, and stay inside their workspace", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "New issue", exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/${acme}/issues/new$`))
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByLabel("Title", { exact: true }).fill("Prepare the enterprise launch")
  await page
    .getByLabel("Description", { exact: true })
    .fill("Confirm SSO, audit logs, and the launch checklist.")
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("Urgent")
  await page
    .getByRole("combobox", { name: "Assignee", exact: true })
    .selectOption({ label: "Maya Patel" })
  await page.getByRole("button", { name: "Create issue", exact: true }).last().click()
  await expect(page.getByRole("heading", { name: "Prepare the enterprise launch" })).toBeVisible()
  const issueUrl = page.url()
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("In progress")
  await page.reload()
  await expect(page).toHaveURL(issueUrl)
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue(
    "In progress",
  )
  await page.getByRole("button", { name: "All issues", exact: true }).click()
  await page.goBack()
  await expect(page).toHaveURL(issueUrl)
  await expect(page.getByRole("heading", { name: "Prepare the enterprise launch" })).toBeVisible()
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Orbit workspace" })
  await expect(page).toHaveURL(new RegExp(`/${orbit}/overview$`))
  await page.goto(issueUrl.replace(acme, orbit))
  await expect(page.getByRole("heading", { name: "Issue not found" })).toBeVisible()
  await page.goto(issueUrl)
  await expect(page.getByRole("heading", { name: "Prepare the enterprise launch" })).toBeVisible()
  await page.getByRole("button", { name: "Reset demo" }).click()
  await page.getByRole("button", { name: "Reset everything" }).click()
  await expect(page).toHaveURL(new RegExp(`/${acme}/overview$`))
  await page.goto(issueUrl)
  await expect(page.getByRole("heading", { name: "Issue not found" })).toBeVisible()
})

test("filters and boards survive refresh, and deleted issue URLs fail clearly", async ({
  page,
}) => {
  await page.goto(`/${acme}/issues`)
  await page.getByRole("textbox", { name: "Search issues" }).fill("SSO")
  await expect(page.getByRole("button", { name: /ACM-128/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /Resolve duplicate/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Board view" }).click()
  await page.reload()
  await expect(page.getByRole("button", { name: "Board view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await expect(page.getByRole("textbox", { name: "Search issues" })).toHaveValue("SSO")
  await page.getByLabel("Filter by priority").selectOption("Low")
  await expect(page.getByText("No issues match this view.", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await page.getByRole("button", { name: /ACM-128/ }).click()
  const issueUrl = page.url()
  await page.getByRole("button", { name: "Delete issue" }).click()
  await page.getByRole("button", { name: "Confirm delete" }).click()
  await page.goto(issueUrl)
  await expect(page.getByRole("heading", { name: "Issue not found" })).toBeVisible()
  await page
    .getByRole("navigation", { name: "Projects", exact: true })
    .getByRole("button", { name: "Billing & payments" })
    .click()
  await expect(page).toHaveURL(/\/projects\/74dcb815/)
  await expect(page.getByRole("heading", { name: "Billing & payments" })).toBeVisible()
})

test("invalid saved data and disabled storage remain usable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("linearity-demo:v1", '{"version":0}'))
  await page.goto("/")
  await expect(page.getByRole("status")).toContainText("couldn't load")
  await page.getByRole("button", { name: "Reset demo" }).click()
  await page.getByRole("button", { name: "Reset everything" }).click()
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled")
    }
  })
  await page.getByRole("button", { name: "Issues", exact: true }).click()
  await page.getByRole("button", { name: /ACM-128/ }).click()
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("Done")
  await expect(page.getByRole("status")).toContainText("storage is unavailable")
  await expect(page.getByRole("combobox", { name: "Status", exact: true })).toHaveValue("Done")
})

for (const viewport of [
  { width: 1440, height: 1000, zoom: 1.4 },
  { width: 1024, height: 768, zoom: 1 },
  { width: 390, height: 844, zoom: 1 },
]) {
  test(`issue page fits ${viewport.width}px at ${viewport.zoom * 100}%`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport)
    await page.addInitScript(
      (zoom) =>
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.style.zoom = String(zoom)
        }),
      viewport.zoom,
    )
    await page.goto(`/${acme}/issues/${sso}`)
    await expect(
      page.getByRole("heading", { name: "Add workspace-level SSO enforcement" }),
    ).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
    const main = page.getByRole("main")
    expect(await main.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true)
    const box = await main.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
    if (viewport.width >= 1000) {
      const astro = await page.getByRole("complementary", { name: "Astro assistant" }).boundingBox()
      expect(box!.x + box!.width).toBeLessThanOrEqual(astro!.x + 1)
      expect(astro!.x + astro!.width).toBeLessThanOrEqual(viewport.width + 1)
      expect(astro!.y + astro!.height).toBeLessThanOrEqual(viewport.height + 1)
    }
    await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("Urgent")
    await expect(page.getByRole("combobox", { name: "Priority", exact: true })).toHaveValue(
      "Urgent",
    )
    await page.screenshot({
      path: testInfo.outputPath(`issue-${viewport.width}-${viewport.zoom}.png`),
      animations: "disabled",
    })
  })
}

test("Basic Auth protects HTML and token requests and rejects cross-origin minting", async ({
  playwright,
  request,
  baseURL,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: baseURL!,
    httpCredentials: { username: "invalid", password: "invalid" },
  })
  for (const path of ["/", "/api/astralbeam/token"]) {
    const response = await anonymous.get(path)
    expect(response.status()).toBe(401)
    expect(response.headers()["www-authenticate"]).toContain("Basic")
    expect(response.headers()["cache-control"]).toContain("no-store")
  }
  const crossOrigin = await request.post("/api/astralbeam/token", {
    headers: { origin: "https://untrusted.example" },
    data: {},
  })
  expect(crossOrigin.status()).toBe(403)
  const invalid = await request.post("/api/astralbeam/token", { data: { workspaceId: "unknown" } })
  expect(invalid.status()).toBe(400)
  await anonymous.dispose()
})

test("tabs share edits without fighting over their workspace URLs", async ({ page, context }) => {
  await page.goto(`/${acme}/issues/${sso}`)
  await expect(
    page.getByRole("heading", { name: "Add workspace-level SSO enforcement" }),
  ).toBeVisible()
  const other = await context.newPage()
  await other.goto(`/${orbit}/overview`)
  await expect(other.getByRole("heading", { name: "Workspace overview" })).toBeVisible()
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("Urgent")
  await expect(other.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue(orbit)
  await expect(page.getByRole("combobox", { name: "Workspace", exact: true })).toHaveValue(acme)
  await other.goto(`/${acme}/issues/${sso}`)
  await expect(other.getByRole("combobox", { name: "Priority", exact: true })).toHaveValue("Urgent")
  await other.close()
})
