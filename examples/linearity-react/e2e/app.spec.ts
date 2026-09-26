import { expect, test } from "@playwright/test"

test("edits persist, workspaces are isolated, and Reset restores both", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "New issue", exact: true }).click()
  await page.getByLabel("Title", { exact: true }).fill("Prepare the enterprise launch")
  await page
    .getByLabel("Description", { exact: true })
    .fill("Confirm SSO, audit logs, and the launch checklist.")
  await page.getByRole("combobox", { name: "Priority", exact: true }).selectOption("Urgent")
  await page
    .getByRole("combobox", { name: "Assignee", exact: true })
    .selectOption({ label: "Maya Patel" })
  await page.getByRole("button", { name: "Create issue", exact: true }).last().click()
  const issue = page.getByRole("button", { name: "ACM-146 Prepare the enterprise launch" })
  await expect(issue).toBeVisible()
  await issue.click()
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("In progress")
  await page.getByRole("button", { name: "Save changes" }).click()
  await page.reload()
  await expect(
    page
      .getByRole("region", { name: "In progress issues", exact: true })
      .getByRole("button", { name: "ACM-146 Prepare the enterprise launch" }),
  ).toBeVisible()
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Orbit workspace" })
  await expect(issue).toHaveCount(0)
  await expect(page.getByRole("button", { name: /ORB-128 Ship regional/ })).toBeVisible()
  await page.getByRole("button", { name: "New issue", exact: true }).click()
  await page.getByLabel("Title", { exact: true }).fill("Orbit-only follow-up")
  await page.getByRole("button", { name: "Create issue", exact: true }).last().click()
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Acme workspace" })
  await expect(issue).toBeVisible()
  await page.getByRole("button", { name: "Reset demo" }).click()
  await page.getByRole("button", { name: "Reset everything" }).click()
  await page.reload()
  await expect(issue).toHaveCount(0)
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Orbit workspace" })
  await expect(page.getByRole("button", { name: /Orbit-only follow-up/ })).toHaveCount(0)
})

test("filters, boards, project navigation, and deletion work", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "Close Astro" }).click()
  await page.getByRole("button", { name: /^Issues/ }).click()
  await page.getByRole("textbox", { name: "Search issues" }).fill("SSO")
  await expect(
    page.getByRole("button", { name: "ACM-128 Add workspace-level SSO enforcement" }),
  ).toBeVisible()
  await expect(page.getByRole("button", { name: /Resolve duplicate/ })).toHaveCount(0)
  await page.getByRole("button", { name: "Board view" }).click()
  await expect(page.getByRole("button", { name: "Board view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  )
  await page.getByLabel("Filter by priority").selectOption("Low")
  await expect(page.getByText("No issues match this view.", { exact: false })).toBeVisible()
  await page.getByRole("button", { name: "Clear filters" }).click()
  await page.getByRole("button", { name: "ACM-128 Add workspace-level SSO enforcement" }).click()
  await page.getByRole("button", { name: "Delete issue" }).click()
  await page.getByRole("button", { name: "Confirm delete" }).click()
  await page.reload()
  await expect(
    page.getByRole("button", { name: "ACM-128 Add workspace-level SSO enforcement" }),
  ).toHaveCount(0)
  await page
    .getByRole("navigation", { name: "Projects", exact: true })
    .getByRole("button", { name: "Billing & payments" })
    .click()
  await expect(page.getByRole("heading", { name: "Billing & payments" })).toBeVisible()
  await expect(page.getByRole("button", { name: /Design the new onboarding/ })).toHaveCount(0)
})

test("invalid saved data and disabled storage remain usable", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("linearity-demo:v1", '{"version":0}'))
  await page.goto("/")
  await expect(page.getByRole("status")).toContainText("couldn't load")
  await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible()
  await page.getByRole("button", { name: "Reset demo" }).click()
  await page.getByRole("button", { name: "Reset everything" }).click()
  await expect(page.getByRole("status")).toHaveCount(0)
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new Error("Storage disabled")
    }
  })
  await page.getByRole("button", { name: "ACM-128 Add workspace-level SSO enforcement" }).click()
  await page.getByRole("combobox", { name: "Status", exact: true }).selectOption("Done")
  await page.getByRole("button", { name: "Save changes" }).click()
  await expect(page.getByRole("status")).toContainText("storage is unavailable")
  await expect(
    page
      .getByRole("region", { name: "Done issues", exact: true })
      .getByRole("button", { name: /ACM-128/ }),
  ).toBeVisible()
})

test("mobile navigation and issue editing stay within the viewport", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  await page.getByRole("button", { name: "Toggle navigation" }).click()
  await page.getByRole("button", { name: "Team", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "New issue", exact: true }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
  await page.screenshot({
    path: testInfo.outputPath("mobile-issue-editor.png"),
    animations: "disabled",
  })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.getByRole("button", { name: "Astro", exact: true }).click()
  await expect(page.getByRole("complementary", { name: "Astro assistant" })).toBeVisible()
})

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
