import { createAstralBeamChat, type AstralBeamChatCoreOptions } from "./session.ts"

// The token cache only reads exp. These tests do not verify a signature.
export const chatTestToken = () => ({
  token: `header.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 }))}.signature`,
})

const sessions: ReturnType<typeof createAstralBeamChat>[] = []

export function createTestSession(options: AstralBeamChatCoreOptions = {}) {
  const chat = createAstralBeamChat({ fetchAstralBeamToken: chatTestToken, ...options })
  sessions.push(chat)
  return chat
}

export function disposeTestSessions() {
  for (const chat of sessions) chat.dispose()
  sessions.length = 0
}
