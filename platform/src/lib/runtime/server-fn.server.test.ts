import { AsyncLocalStorage } from "node:async_hooks"

import {
  createServerEntry,
  getResponseHeaders,
  getResponseStatus,
  setCookie,
} from "@tanstack/react-start/server"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"

import { AgentNameTaken } from "@/lib/agents/errors"
import { exposeError, runEffect } from "./server-fn.server.ts"
import { ServerRequest, tryPromiseInServerRequest } from "./server-request.server.ts"

// A database socket settles a query in the context that opened it, not the caller's.
const outsideAnyRequest = AsyncLocalStorage.snapshot()
const resumeOutsideRequest = Effect.callback<void>((resume) => {
  outsideAnyRequest(() => setTimeout(() => resume(Effect.void), 1))
})

/** Answers one request through TanStack's event storage, as its server function handler does. */
function serveServerFn(effect: Effect.Effect<unknown, unknown, ServerRequest>) {
  return createServerEntry({
    fetch: async () => {
      const outcome = await runEffect(effect, "testServerFn").then(
        () => "ok",
        (error: Error) => error.message,
      )
      return new Response(outcome, {
        status: getResponseStatus(),
        headers: [...getResponseHeaders()],
      })
    },
  }).fetch(new Request("http://localhost/_serverFn/test"))
}

describe("runEffect", () => {
  it("preserves the request's abort reason after cancellation cleanup", async () => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    let finalized = false
    let rejection: unknown
    const response = createServerEntry({
      fetch: async () => {
        await runEffect(
          Effect.callback<void>(() => started.resolve()).pipe(
            Effect.ensuring(Effect.sync(() => (finalized = true))),
          ),
          "cancelledServerFn",
        ).catch((error: unknown) => {
          rejection = error
        })
        return new Response(null, { status: getResponseStatus() })
      },
    }).fetch(new Request("http://localhost/_serverFn/test", { signal: controller.signal }))

    await started.promise
    controller.abort(new DOMException("Navigation cancelled", "AbortError"))
    expect((await response).status).toBe(200)
    expect(rejection).toBe(controller.signal.reason)
    expect(finalized).toBe(true)
  })

  it("keeps headers and cookies on their request across lost and foreign async contexts", async () => {
    let releaseOther: () => void = () => {}
    let insideOther: ((evaluate: () => void) => void) | undefined
    const otherStarted = Promise.withResolvers<void>()
    const other = createServerEntry({
      fetch: async () => {
        insideOther = AsyncLocalStorage.snapshot()
        otherStarted.resolve()
        await new Promise<void>((resolve) => (releaseOther = resolve))
        return new Response("other", { headers: [...getResponseHeaders()] })
      },
    }).fetch(new Request("http://localhost/_serverFn/other"))
    await otherStarted.promise
    // The query's socket was opened by the other request, so its callback resumes there.
    const resumeInOther = Effect.callback<void>((resume) => {
      insideOther!(() => setTimeout(() => resume(Effect.void), 1))
    })
    const response = await serveServerFn(
      Effect.gen(function* () {
        yield* resumeOutsideRequest
        const server = yield* ServerRequest
        yield* server.setHeaders({ "Retry-After": "7" })
        yield* server.setCookie("operator_session", "token", { httpOnly: true, path: "/" })
        yield* resumeInOther
        // Better Auth's cookie plugin calls TanStack helpers inside its Promise.
        yield* tryPromiseInServerRequest(() => Promise.resolve(setCookie("session_token", "mine")))
      }),
    )
    releaseOther()
    expect(await response.text()).toBe("ok")
    expect(response.headers.get("retry-after")).toBe("7")
    expect(response.headers.getSetCookie()).toEqual([
      "operator_session=token; Path=/; HttpOnly",
      "session_token=mine; Path=/",
    ])
    expect((await other).headers.getSetCookie()).toEqual([])
  })

  it("throws an exposed failure as its tag and user-safe message with its status", async () => {
    const response = await serveServerFn(
      Effect.fail(new AgentNameTaken()).pipe(Effect.catchTag("AgentNameTaken", exposeError)),
    )
    expect(await response.text()).toBe("[AgentNameTaken] An agent with this name already exists")
    expect(response.status).toBe(409)
  })

  it("hides unexposed failures and defects behind a reference", async () => {
    for (const effect of [Effect.fail(new AgentNameTaken()), Effect.die(new Error("boom"))]) {
      const response = await serveServerFn(effect)
      expect(await response.text()).toMatch(
        /^\[InternalError\] Something went wrong\. Reference: [0-9a-f]{8}$/,
      )
      expect(response.status).toBe(500)
    }
  })
})
