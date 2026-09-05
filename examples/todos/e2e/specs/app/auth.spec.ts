import { expect, test } from "../../fixtures.ts"
import { mintSeedChatToken } from "../../tokens.ts"
import { seedTarget, webappUrl } from "../../worktree.ts"

/**
 * The chat endpoint's authorization boundary, driven directly rather than through the browser so
 * each case is unambiguous. These protect the rules the widget cannot enforce for itself: a
 * disabled key stops working, and one organization's token cannot reach another's agent.
 */

test("rejects a chat request with no bearer token", async ({ request }) => {
  const response = await request.post(`${webappUrl}/api/chat`, { data: {} })
  expect(response.status()).toBe(401)
})

test("rejects a malformed bearer token", async ({ request }) => {
  const response = await request.get(`${webappUrl}/api/chat/config`, {
    headers: { authorization: "Bearer not-a-jwt" },
  })
  expect(response.status()).toBe(401)
})

test("rejects a token signed with a disabled API key", async ({ request }) => {
  // The signature verifies, because the digest is still stored; the key's `enabled` flag is what
  // must stop it. A regression here would keep revoked credentials working.
  const token = await mintSeedChatToken(seedTarget.revokedApiKey)
  const response = await request.get(`${webappUrl}/api/chat/config`, {
    headers: { authorization: `Bearer ${token}` },
  })
  expect(response.status()).toBe(401)
})

test("will not resolve another organization's agent", async ({ request }) => {
  const token = await mintSeedChatToken(seedTarget.foreignApiKey)
  const response = await request.get(
    `${webappUrl}/api/chat/config?agentId=${seedTarget.agentId}`,
    { headers: { authorization: `Bearer ${token}` } },
  )
  // Indistinguishable from an agent that does not exist, which is the point.
  expect(response.status()).toBe(404)
})

test("resolves each organization's own default agent", async ({ request }) => {
  // Also proves the signatures minted here are genuinely valid, so the rejections above are
  // about the key's state rather than a token this suite got wrong.
  for (const apiKey of [seedTarget.apiKey, seedTarget.foreignApiKey]) {
    const token = await mintSeedChatToken(apiKey)
    const response = await request.get(`${webappUrl}/api/chat/config`, {
      headers: { authorization: `Bearer ${token}` },
    })
    expect(response.status()).toBe(200)
  }
})
