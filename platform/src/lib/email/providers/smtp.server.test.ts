import { assert, describe, it } from "@effect/vitest"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { beforeEach, vi } from "vitest"

const smtpTest = vi.hoisted(() => ({
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}))

// Nodemailer is the vendor boundary, and everything above it runs for real.
vi.mock("nodemailer", () => ({ default: { createTransport: smtpTest.createTransport } }))

import { SmtpProviderSettingsSchema } from "../schemas.ts"
import { EmailProviders } from "./providers.server.ts"
import { testConnection } from "./smtp.server.ts"

const smtpEmail = {
  to: ["person@example.com"],
  from: "sender@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
}

// Outside a test run, so the layer builds real transports over the mocked library.
const deliveringProviders = EmailProviders.layer.pipe(
  Layer.provide(
    ConfigProvider.layer(ConfigProvider.fromUnknown({ VITEST: "false", NODE_ENV: "development" })),
  ),
)

beforeEach(() => {
  vi.resetAllMocks()
  smtpTest.createTransport.mockReturnValue({
    sendMail: smtpTest.sendMail,
    verify: smtpTest.verify,
    close: smtpTest.close,
  })
  smtpTest.sendMail.mockResolvedValue({ messageId: "smtp-message" })
  smtpTest.verify.mockResolvedValue(true)
})

describe("SMTP provider", () => {
  it.effect("reuses one transport per configuration and closes the one it replaces", () =>
    Effect.gen(function* () {
      const providers = yield* EmailProviders
      const defaults = yield* Effect.orDie(
        decodeSmtpTestSettings({ smtp_host: undefined, smtp_port: undefined }),
      )
      assert.strictEqual(
        yield* providers.send({ settings: defaults, email: smtpEmail }),
        "smtp-message",
      )
      yield* providers.send({ settings: defaults, email: smtpEmail })
      assert.strictEqual(smtpTest.createTransport.mock.calls.length, 1)
      assert.deepInclude(smtpTest.createTransport.mock.lastCall?.[0], {
        host: "127.0.0.1",
        port: 1025,
        secure: false,
        ignoreTLS: true,
      })
      assert.notProperty(smtpTest.createTransport.mock.lastCall?.[0], "auth")

      const authenticated = yield* Effect.orDie(
        decodeSmtpTestSettings({
          smtp_host: "smtp.example.com",
          smtp_port: "587",
          smtp_security: "starttls",
          smtp_username: "mailer",
          smtp_password: "secret",
        }),
      )
      yield* providers.send({ settings: authenticated, email: smtpEmail })
      assert.strictEqual(smtpTest.close.mock.calls.length, 1)
      assert.deepInclude(smtpTest.createTransport.mock.lastCall?.[0], {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "mailer", pass: "secret" },
      })
    }).pipe(Effect.provide(deliveringProviders)),
  )

  it.effect("verifies a connection without sending and closes its transport", () =>
    Effect.gen(function* () {
      const settings = yield* Effect.orDie(decodeSmtpTestSettings({}))
      yield* testConnection(settings.settings)
      assert.strictEqual(smtpTest.verify.mock.calls.length, 1)
      assert.strictEqual(smtpTest.close.mock.calls.length, 1)
      assert.strictEqual(smtpTest.sendMail.mock.calls.length, 0)
    }),
  )
})

function decodeSmtpTestSettings(settings: Record<string, unknown>) {
  return Effect.map(
    Schema.decodeUnknownEffect(SmtpProviderSettingsSchema)(settings),
    (decoded) => ({ provider: "smtp" as const, settings: decoded }),
  )
}
