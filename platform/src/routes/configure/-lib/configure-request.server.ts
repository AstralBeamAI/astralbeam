import { Effect, Option, Result } from "effect"

import { Config, readEnvironmentConfig } from "@/lib/config/config"
import { allowInsecure } from "@/lib/runtime/environment.server"
import { ServerRedirect, ServerRequest } from "@/lib/runtime/server-request.server"
import { isTrustedProxyAddress, proxySettingsFromValues } from "@/lib/utils.server"
import { ConfigureHttpsRequired, ConfigureRequestForbidden } from "./errors.ts"

export function isSameOriginConfigureRequest(request: Request, requestUrl: URL): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) return true
  // Browsers omit Fetch Metadata on insecure origins. Origin/Referer checks still apply below.
  // https://www.w3.org/TR/fetch-metadata/#integration-with-fetch-and-html
  const fetchSite = request.headers.get("sec-fetch-site")
  if (fetchSite !== "same-origin" && (fetchSite !== null || !allowInsecure())) return false
  const source = request.headers.get("origin") ?? request.headers.get("referer")
  if (source === null) return false
  const sourceUrl = Result.try(() => new URL(source))
  return Result.isSuccess(sourceUrl) && sourceUrl.success.origin === requestUrl.origin
}

/**
 * Marks responses uncacheable at once, and fails for a request `/configure` must not serve. A page
 * load over plain HTTP in production redirects to HTTPS unless ALLOW_INSECURE=true.
 */
export const checkConfigureRequest = Effect.fn("checkConfigureRequest")(function* () {
  const server = yield* ServerRequest
  // The Referrer-Policy is stricter than the application-wide default, so it stays here.
  yield* server.setHeaders({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Referrer-Policy": "no-referrer",
  })
  const { request } = server
  // Keep operator recovery available before bootstrap and while database settings are unavailable.
  const config = yield* Effect.serviceOption(Config)
  const values = yield* Option.isSome(config)
    ? config.value.snapshot.pipe(
        Effect.map((snapshot) => snapshot.values),
        Effect.catchDefect(() => readEnvironmentConfig()),
      )
    : readEnvironmentConfig()
  const requestUrl = server.url({
    forwarded: isTrustedProxyAddress(server.clientAddress, proxySettingsFromValues(values)),
  })
  if (import.meta.env.PROD && !allowInsecure() && requestUrl.protocol !== "https:") {
    if (["GET", "HEAD"].includes(request.method.toUpperCase())) {
      const httpsUrl = new URL(requestUrl)
      httpsUrl.protocol = "https:"
      return yield* new ServerRedirect({ href: httpsUrl.href, status: 307 })
    }
    return yield* new ConfigureHttpsRequired()
  }
  if (!isSameOriginConfigureRequest(request, requestUrl)) {
    return yield* new ConfigureRequestForbidden()
  }
})
