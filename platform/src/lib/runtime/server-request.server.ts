import { AsyncLocalStorage } from "node:async_hooks"

import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestIP,
  getRequestUrl,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server"
import { Context, Effect, identity, Option, Schema } from "effect"

type ServerCookieOptions = NonNullable<Parameters<typeof setCookie>[2]>

/**
 * The TanStack request an Effect answers. A fiber resumes in the async context of whatever settled
 * its last callback, so TanStack's helpers and Better Auth calls run through `run`, never directly.
 */
export class ServerRequest extends Context.Service<
  ServerRequest,
  {
    readonly request: Request
    readonly clientAddress: string | undefined
    /** The request URL, trusting forwarded host and protocol only when `forwarded` is set. */
    readonly url: (options: { readonly forwarded: boolean }) => URL
    readonly cookie: (name: string) => string | undefined
    readonly setHeaders: (headers: Readonly<Record<string, string>>) => Effect.Effect<void>
    readonly setCookie: (
      name: string,
      value: string,
      options: ServerCookieOptions,
    ) => Effect.Effect<void>
    readonly deleteCookie: (name: string, options: ServerCookieOptions) => Effect.Effect<void>
    /** Runs a callback in the request's async context, where TanStack's helpers find it. */
    readonly run: <A>(evaluate: () => A) => A
  }
>()("astralbeam/runtime/ServerRequest") {}

/** Answers a server function with a redirect, such as a page load that must move to HTTPS. */
export class ServerRedirect extends Schema.TaggedError<ServerRedirect>()("ServerRedirect", {
  href: Schema.String,
  status: Schema.Int,
}) {}

/** Captures the current TanStack request. Call it synchronously in a handler, before any await. */
export function captureServerRequest(): ServerRequest["Service"] {
  const run = AsyncLocalStorage.snapshot()
  return ServerRequest.of({
    request: getRequest(),
    clientAddress: getRequestIP(),
    url: ({ forwarded }) =>
      run(() => getRequestUrl({ xForwardedHost: forwarded, xForwardedProto: forwarded })),
    cookie: (name) => run(() => getCookie(name)),
    setHeaders: (headers) =>
      Effect.sync(() =>
        run(() => {
          for (const [name, value] of Object.entries(headers)) setResponseHeader(name, value)
        }),
      ),
    setCookie: (name, value, options) =>
      Effect.sync(() => run(() => setCookie(name, value, options))),
    deleteCookie: (name, options) => Effect.sync(() => run(() => deleteCookie(name, options))),
    run: (evaluate) => run(evaluate),
  })
}

/**
 * Awaits a Promise API in the current request's async context when there is one, so Better Auth's
 * cookie plugin answers the request that called it. Fails with the API's own rejection.
 */
export function tryPromiseInServerRequest<A>(
  evaluate: () => Promise<A>,
): Effect.Effect<A, unknown> {
  return Effect.flatMap(Effect.serviceOption(ServerRequest), (request) =>
    Effect.tryPromise({
      try: () => (Option.isSome(request) ? request.value.run(evaluate) : evaluate()),
      catch: identity,
    }),
  )
}
