import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { DatabaseRateLimiter } from "@/db/lib/rate-limiter"
import { Auth } from "@/lib/auth/auth.server"
import { Config } from "@/lib/config/config"
import { Mailer } from "@/lib/email/email.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { toValidationSchema } from "@/lib/schemas"
import { SupportRequestRateLimited } from "../-lib/errors"
import { SupportRequestSchema } from "../-lib/schemas"

/** Emails the signed-in user a copy of their support request, with the support address copied. */
export const sendSupportRequest = createServerFn({ method: "POST" })
  .validator(toValidationSchema(SupportRequestSchema))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const { headers } = (yield* ServerRequest).request
        const session = yield* Effect.flatMap(Auth, (auth) => auth.requireSession({ headers }))
        const config = yield* Config
        yield* Effect.flatMap(DatabaseRateLimiter, (limiter) =>
          limiter.consume({
            key: `support-request:${session.user.id}`,
            limit: 5,
            window: "1 hour",
          }),
        ).pipe(
          Effect.catch((error) =>
            error.reason._tag === "RateLimitExceeded"
              ? Effect.fail(new SupportRequestRateLimited())
              : Effect.die(error),
          ),
        )
        const appBaseUrl = yield* config.get("app_base_url")
        const pageURL = appBaseUrl && data.pagePath ? URL.parse(data.pagePath, appBaseUrl) : null
        const attachments = yield* Effect.forEach(data.attachments, (file) =>
          Effect.map(
            Effect.promise(() => file.bytes()),
            (content) => ({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              content,
            }),
          ),
        )
        yield* Effect.flatMap(Mailer, (mailer) =>
          mailer.sendSupportRequest({
            user: session.user,
            message: data.message,
            // Only dashboard pages are worth linking, so a foreign origin is dropped.
            pageURL: pageURL && pageURL.origin === appBaseUrl ? pageURL.href : undefined,
            attachments,
          }),
        )
      }).pipe(
        Effect.catchTag(
          ["SignInRequired", "SupportRequestRateLimited", "EmailDeliveryError"],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
