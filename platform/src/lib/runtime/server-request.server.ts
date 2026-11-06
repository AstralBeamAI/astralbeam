import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestIP,
  getRequestUrl,
  setCookie,
  setResponseHeaders,
} from "@tanstack/react-start/server"
import { Context, Effect } from "effect"

type ServerCookieOptions = NonNullable<Parameters<typeof setCookie>[2]>

/** The current TanStack request and response operations for an Effect. */
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
  }
>()("astralbeam/runtime/ServerRequest") {}

/** Captures the current TanStack request and response operations. */
export function captureServerRequest(): ServerRequest["Service"] {
  return ServerRequest.of({
    request: getRequest(),
    clientAddress: getRequestIP(),
    url: ({ forwarded }) =>
      getRequestUrl({ xForwardedHost: forwarded, xForwardedProto: forwarded }),
    cookie: getCookie,
    setHeaders: (headers) => Effect.sync(() => setResponseHeaders(new Headers(headers))),
    setCookie: (name, value, options) => Effect.sync(() => setCookie(name, value, options)),
    deleteCookie: (name, options) => Effect.sync(() => deleteCookie(name, options)),
  })
}
