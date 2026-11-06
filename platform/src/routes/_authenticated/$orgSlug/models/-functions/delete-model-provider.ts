import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { ModelProviders } from "@/lib/model-providers/model-providers.server"
import { organizationAccessMiddleware } from "@/lib/organizations/middleware"
import { effectHandler, exposeError } from "@/lib/runtime/server-fn.server"
import { toValidationSchema } from "@/lib/schemas"
import { ModelProviderVersionInputSchema } from "../-lib/schemas"

export const deleteModelProvider = createServerFn({ method: "POST" })
  .middleware([organizationAccessMiddleware({ organizationConfiguration: ["delete"] })])
  .validator(toValidationSchema(ModelProviderVersionInputSchema))
  .handler(
    effectHandler(({ context, data }) =>
      Effect.flatMap(ModelProviders, (providers) =>
        providers.remove({
          organizationId: context.organizationId,
          id: data.id,
          lockVersion: data.lockVersion,
        }),
      ).pipe(Effect.catchTag(["ModelProviderChanged", "ModelProviderInUse"], exposeError)),
    ),
  )
