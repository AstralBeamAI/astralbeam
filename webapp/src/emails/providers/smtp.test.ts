import { beforeEach, expect, test, vi } from "vitest"

const smtpTest = vi.hoisted(() => ({
  config: {} as Record<string, string>,
  createTransport: vi.fn(),
  sendMail: vi.fn(),
  verify: vi.fn(),
  close: vi.fn(),
}))

vi.mock("nodemailer", () => ({
  default: { createTransport: smtpTest.createTransport },
}))
vi.mock("../../lib/config/index.ts", () => ({
  getGlobalConfig: (key: string) => Promise.resolve(smtpTest.config[key]),
}))

import { sendSmtpEmail, testConnection } from "./smtp.ts"

beforeEach(() => {
  vi.resetAllMocks()
  smtpTest.config = {}
  smtpTest.createTransport.mockReturnValue({
    sendMail: smtpTest.sendMail,
    verify: smtpTest.verify,
    close: smtpTest.close,
  })
  smtpTest.sendMail.mockResolvedValue({ messageId: "smtp-message" })
  smtpTest.verify.mockResolvedValue(true)
})

test("maps SMTP defaults, security, and optional authentication", async () => {
  const input = {
    to: ["person@example.com"],
    from: "sender@example.com",
    subject: "Hello",
    html: "<p>Hello</p>",
    replyTo: ["sender@example.com"],
    attachments: [],
  }
  await sendSmtpEmail(input)
  expect(smtpTest.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({
    host: "127.0.0.1",
    port: 1025,
    secure: false,
    ignoreTLS: true,
  }))
  expect(smtpTest.createTransport.mock.lastCall?.[0]).not.toHaveProperty("auth")

  smtpTest.config = {
    smtp_host: "smtp.example.com",
    smtp_port: "587",
    smtp_security: "starttls",
    smtp_username: "mailer",
    smtp_password: "secret",
  }
  await sendSmtpEmail(input)
  expect(smtpTest.createTransport).toHaveBeenLastCalledWith(expect.objectContaining({
    host: "smtp.example.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: "mailer", pass: "secret" },
  }))

  await testConnection({
    smtp_host: "127.0.0.1",
    smtp_port: 1025,
    smtp_security: "none",
    smtp_username: "",
    smtp_password: "",
  })
  expect(smtpTest.verify).toHaveBeenCalledOnce()
  expect(smtpTest.close).toHaveBeenCalledOnce()
})
