import { assert, describe, it } from "@effect/vitest"
import { Context, Effect, Layer, Logger } from "effect"

import { Config } from "@/lib/config/config.server"
import { APP_NAME } from "@/lib/constants"

import { Mailer } from "./email.server.ts"
import { EmailDeliveryError } from "./errors.ts"
import { maskEmailAddressForLog } from "./messages.server.ts"
import { EmailProviders, type ProviderEmail } from "./providers/providers.server.ts"

const MAILER_TEST_CONFIG = {
  app_base_url: "https://app.example.test",
  email_from_address: "Example App <auth@example.test>",
  email_provider: "resend",
  resend_api_key: "re_private_key",
  support_email_address: "support@example.test",
}

function mailerTestLayer(options: { readonly failure?: EmailDeliveryError } = {}) {
  const sent: ProviderEmail[] = []
  const lines: string[] = []
  const providers = Layer.succeed(EmailProviders, {
    send: ({ email }) => {
      sent.push(email)
      return options.failure ? Effect.fail(options.failure) : Effect.succeed("test-message")
    },
    testConnection: () => Effect.void,
  })
  const layer = Mailer.layerNoDeps.pipe(
    Layer.provide([
      providers,
      Layer.succeed(Config, {
        snapshot: Effect.succeed({ values: MAILER_TEST_CONFIG }),
      } as unknown as Context.Service.Shape<typeof Config>),
    ]),
    Layer.provideMerge(Logger.layer([Logger.map(Logger.formatJson, (line) => lines.push(line))])),
  )
  return { layer, sent, lines }
}

describe("Mailer", () => {
  it.effect("logs a delivered send once with a masked recipient and no token URL", () => {
    const { layer, lines } = mailerTestLayer()
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      yield* mailer.sendVerification({
        user: { email: "member@example.test" },
        url: "https://app.example.test/api/auth/verify-email?token=secret-token",
        expiresInSeconds: 3600,
      })
      assert.lengthOf(lines, 1)
      assert.include(lines[0], "m***r@example.test")
      assert.include(lines[0], "test-message")
      assert.notInclude(lines[0], "member@example.test")
      assert.notInclude(lines[0], "secret-token")
    }).pipe(Effect.provide(layer))
  })

  it.effect("logs a failed send with its safe reason and fails with a delivery error", () => {
    const { layer, lines } = mailerTestLayer({
      failure: new EmailDeliveryError({ reason: "validation_error" }),
    })
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      const error = yield* Effect.flip(
        mailer.sendResetPassword({
          user: { email: "member@example.test" },
          url: "https://app.example.test/api/auth/reset-password/secret-token",
          expiresInSeconds: 3600,
        }),
      )
      assert.strictEqual(error._tag, "EmailDeliveryError")
      assert.lengthOf(lines, 1)
      assert.include(lines[0], "validation_error")
      assert.include(lines[0], "m***r@example.test")
      assert.notInclude(lines[0], "member@example.test")
      assert.notInclude(lines[0], "secret-token")
      assert.notInclude(lines[0], "re_private_key")
    }).pipe(Effect.provide(layer))
  })

  it.effect("copies support on welcome and support emails so replies reach the team", () => {
    const { layer, sent } = mailerTestLayer()
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      const user = { name: "Alex Morgan", email: "member@example.test" }
      const attachment = {
        filename: "error.png",
        contentType: "image/png",
        content: new Uint8Array([1, 2, 3]),
      }
      yield* mailer.sendWelcome({ user })
      yield* mailer.sendSupportRequest({
        user,
        message: "The sidebar\nstops responding",
        attachments: [attachment],
      })
      yield* mailer.sendPasswordChanged({ user })
      const [welcome, support, passwordChanged] = sent
      for (const email of [welcome, support]) {
        assert.deepStrictEqual(email?.to, [user.email])
        assert.deepStrictEqual(email?.cc, ["support@example.test"])
        assert.strictEqual(email?.replyTo, "support@example.test")
      }
      assert.strictEqual(support?.subject, `${APP_NAME} support request: The sidebar`)
      assert.include(support?.text, "stops responding")
      assert.deepStrictEqual(support?.attachments, [attachment])
      assert.deepStrictEqual(passwordChanged?.cc, [])
      assert.strictEqual(passwordChanged?.replyTo, MAILER_TEST_CONFIG.email_from_address)
    }).pipe(Effect.provide(layer))
  })

  it.effect("preserves Better Auth links verbatim and builds absolute application links", () => {
    const { layer, sent } = mailerTestLayer()
    return Effect.gen(function* () {
      const mailer = yield* Mailer
      const verificationURL =
        "https://app.example.test/api/auth/verify-email?token=verify-secret&callbackURL=%2F"
      yield* mailer.sendVerification({
        user: { email: "member@example.test" },
        url: verificationURL,
        expiresInSeconds: 45 * 60,
      })
      const invitationId = "invite/id +?"
      yield* mailer.sendOrganizationInvitation({
        expiresInSeconds: 72 * 60 * 60,
        id: invitationId,
        email: "new-member@example.test",
        role: "owner,developer,owner",
        organization: { name: "Example Organization" },
        inviter: { user: { name: "Alex Morgan", email: "owner@example.test" } },
      })
      yield* mailer.sendPasswordChanged({
        user: { email: "member@example.test" },
        changedAt: new Date("2026-08-27T10:00:00.000Z"),
      })
      const [verification, invitation, passwordChanged] = sent
      assert.include(verification?.text, verificationURL)
      assert.include(verification?.text, "45 minutes")
      assert.strictEqual(verification?.from, MAILER_TEST_CONFIG.email_from_address)
      const invitationURL = new URL("/auth/accept-invitation", MAILER_TEST_CONFIG.app_base_url)
      invitationURL.searchParams.set("invitationId", invitationId)
      assert.deepStrictEqual(invitation?.to, ["new-member@example.test"])
      assert.include(invitation?.text, invitationURL.toString())
      assert.include(invitation?.text, "72 hours")
      assert.include(passwordChanged?.text, "https://app.example.test/auth/forgot-password")
      // Whoever changed the password holds the session, so recovery never starts from settings.
      assert.notInclude(passwordChanged?.text, "/settings/security")
    }).pipe(Effect.provide(layer))
  })
})

describe("EmailProviders", () => {
  it.effect("refuses delivery during a test run so no test reaches a real provider", () =>
    Effect.gen(function* () {
      const providers = yield* EmailProviders
      const error = yield* Effect.flip(
        providers.send({
          settings: { provider: "resend", settings: { resend_api_key: "re_private_key" } },
          email: {
            to: ["person@example.com"],
            cc: [],
            from: "sender@example.com",
            replyTo: "sender@example.com",
            subject: "Test",
            html: "<p>Test</p>",
            text: "Test",
            attachments: [],
          },
        }),
      )
      assert.strictEqual(error.reason, "disabled-in-tests")
    }).pipe(Effect.provide(EmailProviders.layer)),
  )
})

it("masks a logged recipient's local part without revealing its length", () => {
  assert.strictEqual(maskEmailAddressForLog("member@example.com"), "m***r@example.com")
  assert.strictEqual(maskEmailAddressForLog("a.very.long.address@example.com"), "a***s@example.com")
  // Short local parts drop the trailing character so two of them cannot be told apart.
  assert.strictEqual(maskEmailAddressForLog("ab@example.com"), "a***@example.com")
  assert.strictEqual(maskEmailAddressForLog("abc@example.com"), "a***@example.com")
  assert.strictEqual(maskEmailAddressForLog("not-an-address"), "***")
  assert.strictEqual(maskEmailAddressForLog("@example.com"), "***")
})
