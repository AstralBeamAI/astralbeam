import { GetAccountCommand, SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2"
import { Config, Effect } from "effect"

import { EmailConnectionFailed } from "../errors.ts"
import type { SesProviderSettings } from "../schemas.ts"
import { emailConnectionCheck, emailProviderCall, type ProviderEmail } from "./providers.ts"

const acquireSesClient = Effect.fnUntraced(function* (settings: SesProviderSettings) {
  // Standard AWS environment credentials belong to the SDK chain so temporary credentials retain
  // AWS_SESSION_TOKEN. Only database-backed static credentials are passed explicitly.
  const environmentKeyId = yield* Config.String("AWS_ACCESS_KEY_ID").pipe(
    Config.withDefault(""),
    Effect.orDie,
  )
  const credentials =
    !environmentKeyId && settings.aws_access_key_id && settings.aws_secret_access_key
      ? { accessKeyId: settings.aws_access_key_id, secretAccessKey: settings.aws_secret_access_key }
      : undefined
  return yield* Effect.acquireRelease(
    Effect.sync(
      () =>
        new SESv2Client({
          region: settings.aws_region,
          // Without configured credentials, the default chain supports roles, SSO/profiles, and
          // temporary environment credentials. https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html
          ...(credentials ? { credentials } : {}),
        }),
    ),
    (client) => Effect.sync(() => client.destroy()),
  )
})

export const testConnection = (settings: SesProviderSettings) =>
  Effect.scoped(
    Effect.flatMap(acquireSesClient(settings), (client) =>
      emailConnectionCheck((abortSignal) =>
        client.send(new GetAccountCommand({}), { abortSignal }),
      ),
    ),
  ).pipe(
    Effect.flatMap((account) =>
      account.SendingEnabled === false
        ? Effect.fail(
            new EmailConnectionFailed({
              message:
                "Amazon SES is reachable, but sending is disabled for this account in the selected region",
            }),
          )
        : Effect.void,
    ),
  )

export const acquireSender = (settings: SesProviderSettings) =>
  Effect.map(
    acquireSesClient(settings),
    (client) => (email: ProviderEmail) =>
      emailProviderCall((abortSignal) =>
        client.send(
          new SendEmailCommand({
            FromEmailAddress: email.from,
            Destination: { ToAddresses: [...email.to], CcAddresses: [...email.cc] },
            ReplyToAddresses: [email.replyTo],
            Content: {
              Simple: {
                Subject: { Data: email.subject, Charset: "UTF-8" },
                Body: {
                  Html: { Data: email.html, Charset: "UTF-8" },
                  Text: { Data: email.text, Charset: "UTF-8" },
                },
                Attachments: email.attachments.map((attachment) => ({
                  FileName: attachment.filename,
                  ContentType: attachment.contentType,
                  RawContent: attachment.content,
                })),
              },
            },
          }),
          { abortSignal },
        ),
      ).pipe(Effect.map((response) => response.MessageId)),
  )
