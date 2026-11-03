import { Effect, Schema } from "effect"
import { HttpApiBuilder, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import type { ApiV1 } from "./contract.server"
import { NonEmptyStringSchema } from "@/lib/schemas"
import { restResourceSecurity } from "./shared.server"

const DocsSearchResponse = Schema.Struct({
  results: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      url: Schema.String,
      page: Schema.String,
      heading: Schema.String,
      text: Schema.String,
    }),
  ),
}).annotate({ identifier: "DocumentationSearch" })

export const documentationApi = HttpApiGroup.make("documentation", { topLevel: true }).add(
  HttpApiEndpoint.get("searchDocumentation", "/docs/search", {
    query: Schema.Struct({ q: NonEmptyStringSchema.check(Schema.isMaxLength(255)) }),
    success: DocsSearchResponse,
  })
    .annotate(OpenApi.Summary, "Search documentation")
    .annotate(
      OpenApi.Description,
      "Search the published guides and API reference. Returns up to five matching pages with relative URLs and the best matching section. Accepts the same credentials as the resource APIs.",
    )
    .annotate(OpenApi.Override, restResourceSecurity),
)

export function documentationHandlers(api: typeof ApiV1) {
  return HttpApiBuilder.group(api, "documentation", (handlers) =>
    handlers.handle(
      "searchDocumentation",
      Effect.fn("searchDocumentation")(function* ({ query }) {
        const { searchDocs } = yield* Effect.promise(() => import("@/routes/docs/-lib/search"))
        return yield* Effect.promise(() => searchDocs(query.q))
      }),
    ),
  )
}
