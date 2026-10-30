import { Effect } from "effect"
import { expect, it } from "@effect/vitest"

import { Config } from "@/lib/config/config"
import { SignInRequired } from "@/lib/organizations/errors"
import { ServerRequest } from "@/lib/runtime/server-request.server"
import { fileResponse } from "./file-response.server"

it.effect("keeps direct and proxy delivery behind authorization", () =>
  Effect.gen(function* () {
    const location = "https://storage.example/private-object?X-Amz-Signature=fixture"
    for (const [delivery, marker, denied, status] of [
      [undefined, "1", false, 302],
      ["proxy", "", false, 503],
      ["proxy", "1", false, 200],
      ["proxy", "1", true, 401],
    ] as const) {
      const request = new Request("http://localhost/api/files/example", {
        headers: { "x-asset-proxy": marker, "if-none-match": '"cached"' },
      })
      const response = yield* fileResponse(
        denied ? Effect.fail(new SignInRequired()) : Effect.succeed(location),
      ).pipe(
        Effect.provideService(Config, {
          snapshot: Effect.succeed({ values: { asset_delivery: delivery } }),
        } as Config["Service"]),
        Effect.provideService(ServerRequest, {
          request,
          clientAddress: "127.0.0.1",
          url: () => new URL(request.url),
          cookie: () => undefined,
          setHeaders: () => Effect.void,
          setCookie: () => Effect.void,
          deleteCookie: () => Effect.void,
          run: (evaluate) => evaluate(),
        }),
      )
      expect(response.status).toBe(status)
      expect(response.headers.get("cache-control")).toBe("private, no-store")
      expect(response.body).toBeNull()
      expect(response.headers.get("location")).toBe(status === 302 ? location : null)
      expect(response.headers.get("x-accel-redirect")).toBe(
        status === 200 ? "/private-object?X-Amz-Signature=fixture" : null,
      )
    }
  }),
)
