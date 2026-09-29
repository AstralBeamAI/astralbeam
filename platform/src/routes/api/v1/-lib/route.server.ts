import { getApiV1WebHandler } from "./transport.server"

/** The one entrypoint for v1 and its aliases, which the Effect web handler answers in full. */
export function handleApiV1Request(request: Request): Promise<Response> {
  return getApiV1WebHandler().handler(request)
}
