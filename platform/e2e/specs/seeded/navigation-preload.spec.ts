import { Buffer } from "node:buffer"

import { SEED_ORGANIZATIONS } from "@scripts/seed/fixtures.ts"
import { captureMilestone } from "@e2e/capture.ts"
import { expect, test } from "@e2e/fixtures.ts"
import { waitForHydration } from "@e2e/hydration.ts"

test("dashboard navigation reuses completed intent preloads", async ({ page, shell }) => {
  await page.goto(`/${SEED_ORGANIZATIONS[0].slug}`)
  const agents = shell.sectionLink("Agents")
  await waitForHydration(agents)

  let agentLoads = 0
  const isAgentsLoader = (url: string) => {
    const path = new URL(url).pathname
    return (
      path.startsWith("/_serverFn/") &&
      Buffer.from(path.split("/").at(-1)!, "base64url").toString().includes("/agents/-functions/")
    )
  }
  page.on("request", (request) => {
    if (isAgentsLoader(request.url())) agentLoads++
  })
  const preloaded = page.waitForResponse((response) => isAgentsLoader(response.url()))
  await agents.hover()
  await (await preloaded).finished()
  await captureMilestone(page, "hover-preloaded")
  await agents.click()
  await expect(page.getByRole("heading", { name: "Agents", exact: true })).toBeVisible()
  expect(agentLoads).toBe(1)
})
