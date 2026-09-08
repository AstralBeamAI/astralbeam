import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/api/openapi.json")({
  server: {
    handlers: {
      GET: async () => {
        const [{ OpenApi }, { TenantRestApi }] = await Promise.all([
          import("effect/unstable/httpapi"),
          import("./v1/-lib/contract.server"),
        ])
        return Response.json(OpenApi.fromApi(TenantRestApi), {
          headers: { "Access-Control-Allow-Origin": "*" },
        })
      },
    },
  },
})
