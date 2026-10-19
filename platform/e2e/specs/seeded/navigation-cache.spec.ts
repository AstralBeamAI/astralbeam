import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"

test("returning to a list reuses its data while route access checks run again", async ({
  page,
  shell,
}) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}/models`)
  await waitForHydration(shell.sectionLink("Agents"))
  const requests: string[] = []
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname
    if (pathname.startsWith("/_serverFn/")) requests.push(pathname)
  })
  await shell.openSection("Agents", "Agents")
  await page.waitForLoadState("networkidle")
  const firstVisit = new Set(requests)
  requests.length = 0
  await shell.openSection("Models", "Models")
  await page.waitForLoadState("networkidle")
  const accessChecks = new Set(requests)
  const pageReads = [...firstVisit].filter((path) => !accessChecks.has(path))
  expect(pageReads).toHaveLength(1)
  requests.length = 0
  await shell.openSection("Agents", "Agents")
  await page.waitForLoadState("networkidle")
  expect(requests).not.toContain(pageReads[0])
  expect(requests.some((path) => accessChecks.has(path))).toBe(true)
  await captureMilestone(page, "agents-reused-after-navigation")
})
