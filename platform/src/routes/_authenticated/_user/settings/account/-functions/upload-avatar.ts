import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { Auth } from "@/lib/auth/auth.server"
import { exposeError, runEffect } from "@/lib/runtime/server-fn.server"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { toValidationSchema } from "@/lib/schemas"
import { AvatarUploadSchema } from "@/lib/storage/images"
import { ProfileFiles } from "@/lib/storage/profile-files.server"

export const uploadAvatar = createServerFn({ method: "POST" })
  .validator(toValidationSchema(AvatarUploadSchema))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.gen(function* () {
        const server = yield* ServerRequest
        const auth = yield* Auth
        const session = yield* auth.requireSession({ headers: server.request.headers })
        const files = yield* ProfileFiles
        return yield* files.uploadAvatar({ userId: session.user.id, bytes: data.bytes })
      }).pipe(
        Effect.catchTag(
          [
            "SignInRequired",
            "InvalidImage",
            "StorageUnavailable",
            "StorageObjectMissing",
            "ImageUploadRateLimited",
          ],
          exposeError,
        ),
      ),
      serverFnMeta.name,
    ),
  )
