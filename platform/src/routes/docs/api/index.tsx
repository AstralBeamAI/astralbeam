import { createFileRoute } from "@tanstack/react-router"
import type { OpenApi } from "effect/http-api"
import { APP_NAME } from "@/lib/constants"
import { ApiDocsReference } from "./-components/api-reference"

export const Route = createFileRoute("/docs/api/")({
  ssr: false,
  loader: async ({ abortController }) => {
    const response = await fetch("/api/openapi.json", { signal: abortController.signal })
    if (!response.ok) throw new Error("Unable to load the API reference.")
    const content = (await response.json()) as OpenApi.OpenAPISpec
    // Group errors for presentation only. Downloads keep the canonical explicit status codes.
    for (const methods of Object.values(content.paths)) {
      for (const operation of Object.values(methods)) {
        if (!("responses" in operation)) continue
        const responses = operation.responses as Record<
          string,
          OpenApi.OpenAPISpecResponses[number]
        >
        if (!responses["400"]) continue
        responses.default = {
          ...responses["400"],
          description:
            "Error response. See [Errors](#description/errors) for status codes and handling.",
        }
        for (const status of Object.keys(responses)) {
          if (Number(status) >= 400) delete responses[status]
        }
      }
    }
    return content
  },
  head: () => ({
    meta: [
      { title: `${APP_NAME} API` },
      {
        name: "description",
        content: `HTTP API reference for ${APP_NAME}, including authentication, Tenants, TenantUsers, pagination, and errors.`,
      },
    ],
  }),
  component: ApiDocsReference,
})
