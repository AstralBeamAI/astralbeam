import { expect, test } from "@playwright/test"

import { mintSeedChatToken, readJwtHeader } from "./tokens.ts"
import { seedTarget, todosUrl, webappUrl } from "./worktree.ts"

/**
 * Fails once, with something to act on, when the environment is not ready. Both spec projects
 * depend on this file, so a database that was never seeded does not fail every spec in turn.
 */

test("the todos token route mints a token for the seeded API key", async ({ request }) => {
  const response = await request.post(`${todosUrl}/api/astralbeam/token`)
  expect(
    response.status(),
    "The token route did not answer 200. A 503 means ASTRALBEAM_API_KEY never reached the server, usually a stale examples/todos/.env overriding it.",
  ).toBe(200)
  const { token } = await response.json() as { token?: string }
  expect(token, "The token route returned no token").toBeTruthy()

  // The key ID rides in the JWT header, so this catches a server signing with a different key.
  const header = readJwtHeader(token!)
  expect(
    header.kid,
    "The token was signed with an unexpected API key; check ASTRALBEAM_API_KEY",
  ).toBe(`key_${seedTarget.organizationSlug}_todos`)
})

test("the webapp accepts a seeded chat token and resolves the seeded agent", async ({ request }) => {
  const token = await mintSeedChatToken(seedTarget.apiKey)
  const response = await request.get(
    `${webappUrl}/api/chat/config?agentId=${seedTarget.agentId}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  expect(
    response.status(),
    `The webapp rejected the seeded API key or agent. Run \`deno task db-seed\` from \`webapp\` against the database this server uses (${response.status()} ${await response
      .text()}).`,
  ).toBe(200)
  expect(await response.json()).toEqual({ capabilities: { attachments: true } })
})
