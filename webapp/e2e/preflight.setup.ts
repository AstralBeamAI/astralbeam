import { expect, test } from "@playwright/test"

import { e2eDatabaseUrl, mailboxUrl, webappUrl } from "./worktree.ts"

/**
 * Fails once, with something to act on, when the environment is not ready. The journey depends on
 * this file, so a broken server does not fail every step in turn.
 */

test("the webapp and the mail sink are both answering", async ({ request }) => {
  expect((await request.get(`${webappUrl}/api/status`)).status()).toBe(200)
  const mailbox = await request.get(`${mailboxUrl}/health`)
  expect(mailbox.status(), "The mail sink did not start").toBe(200)
  expect(await mailbox.json()).toMatchObject({ ok: true })
})

test("the server is running against the suite's freshly prepared database", async ({ request }) => {
  // A prepared database holds no configuration, so the root route redirects to `/configure`. A
  // response from anywhere else means DATABASE_URL did not reach the server.
  const response = await request.get(webappUrl)
  expect(
    new URL(response.url()).pathname,
    `The server did not start on an empty database. Expected ${e2eDatabaseUrl}.`,
  ).toBe("/configure")
})
