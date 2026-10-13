import { captureMilestone } from "../../capture.ts"
import { test } from "../../fixtures.ts"
import { makeRunIdentity } from "../../identity.ts"

test("manages immutable MCP definitions for private embedded accounts", async ({
  page,
  baseline,
  mcp,
}) => {
  const { runId } = makeRunIdentity()
  const endpoint = `https://mcp-${runId}.example.test/mcp`
  await mcp.open(baseline.organizationSlug)
  await mcp.inspectGoogleSetup()
  await mcp.createStaticServer(endpoint)
  await captureMilestone(page, "mcp-private-server-definition")
  await page.setViewportSize({ width: 390, height: 844 })
  await captureMilestone(page, "mcp-mobile-server-definition")
  await mcp.removeServer(endpoint)
})
