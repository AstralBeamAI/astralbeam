import { captureMilestone } from "../../capture.ts"
import { test } from "../../fixtures.ts"
import { makeRunIdentity } from "../../identity.ts"

test("manages independent MCP accounts and policies without exposing stored credentials", async ({
  page,
  baseline,
  mcp,
}) => {
  const { runId } = makeRunIdentity()
  const serverName = `Remote tools ${runId}`
  const workName = `Work account ${runId}`
  await mcp.open(baseline.organizationSlug)
  await mcp.inspectGoogleSetup()
  await mcp.createStaticServer(serverName)
  await mcp.createAccount(workName, serverName)
  await mcp.renameAccount(workName, `${workName} renamed`)
  await mcp.rejectPartialCredentialReplacement(`${workName} renamed`)
  await mcp.enableByo()
  await captureMilestone(page, "mcp-encrypted-account-and-independent-policy")
  await page.setViewportSize({ width: 390, height: 844 })
  await captureMilestone(page, "mcp-mobile-account-management")
  await mcp.removeAccount(`${workName} renamed`)
  await mcp.removeServer(serverName)
})
