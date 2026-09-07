import { expect, test } from "vitest"

import limits from "../-content/sdk/limits.md?raw"
import {
  CHAT_ATTACHMENT_MAX_BYTES_BY_KIND,
  CHAT_ATTACHMENT_MAX_COUNT,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS,
  CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS,
  CHAT_MAX_REQUEST_BYTES,
  CHAT_RATE_LIMIT_MAX_REQUESTS,
  CHAT_RATE_LIMIT_WINDOW_MS,
} from "@/routes/api/chat/-lib/constants.server"

/** The docs page's own form for a byte cap, so a changed constant reads as a changed page. */
function megabytes(bytes: number): string {
  return `${bytes / (1024 * 1024)} MB`
}

// Drift guard, not a structure test: each documented number is asserted as a substring rendered
// from its constant, so the prose stays the owner's to reword while the values stay pinned.
test("the Limits page quotes the caps the chat endpoint enforces", () => {
  const expected = [
    `limit of ${CHAT_ATTACHMENT_MAX_COUNT} attachments`,
    ...Object.values(CHAT_ATTACHMENT_MAX_BYTES_BY_KIND).map(megabytes),
    megabytes(CHAT_ATTACHMENT_MAX_TOTAL_BYTES),
    megabytes(CHAT_MAX_REQUEST_BYTES),
    `${CHAT_RATE_LIMIT_MAX_REQUESTS} requests per ${CHAT_RATE_LIMIT_WINDOW_MS / 1_000} seconds`,
    `${CHAT_AUTH_TOKEN_MIN_LIFETIME_SECONDS}–${CHAT_AUTH_TOKEN_MAX_LIFETIME_SECONDS} seconds`,
  ]
  for (const value of expected) expect(limits).toContain(value)
})
