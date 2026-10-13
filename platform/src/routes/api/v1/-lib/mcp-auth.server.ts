import { Effect } from "effect"
import { ChatThreads } from "@/lib/chat/threads/threads"
import {
  consumeRestRateLimit,
  authenticateRestTenantToken,
  readRestBearerToken,
} from "./auth.server"
import { RestInvalidCredentials, RestResourceNotFound } from "./errors.ts"

export const authenticateMcpRequest = Effect.fn("authenticateMcpRequest")(function* (
  request: Request,
) {
  if (request.headers.has("x-api-key") || !readRestBearerToken(request))
    return yield* new RestInvalidCredentials()
  const principal = yield* authenticateRestTenantToken(request)
  const actor = yield* (yield* ChatThreads)
    .resolveScope({ principal })
    .pipe(Effect.mapError(() => new RestResourceNotFound()))
  yield* consumeRestRateLimit("mcp", [actor.organizationId, actor.tenantId, actor.tenantUserId])
  return actor
})
