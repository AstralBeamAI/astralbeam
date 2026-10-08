import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { runEffect } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { ObjectStorage } from "@/lib/storage/object-storage.server"
import { StorageConnectionSchema } from "@/lib/storage/schemas"
import { configureMiddleware } from "../-lib/configure-middleware"

export const testStorageConnection = createServerFn({ method: "POST" })
  .middleware([configureMiddleware])
  .validator(toValidationSchema(StorageConnectionSchema))
  .handler(({ data, serverFnMeta }) =>
    runEffect(
      Effect.flatMap(ObjectStorage, (storage) => storage.testConnection(data)).pipe(
        Effect.as({ ok: true as const }),
        Effect.catchTag(["StorageUnavailable", "StorageObjectMissing"], () =>
          Effect.succeed({ ok: false as const }),
        ),
      ),
      serverFnMeta.name,
    ),
  )
