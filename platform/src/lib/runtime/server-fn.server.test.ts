import { AsyncLocalStorage } from "node:async_hooks"

import { getResponseStatus, requestHandler, setCookie } from "@tanstack/react-start/server"
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Effect, Logger } from "effect"
import { describe, expect, it } from "vitest"

import { AgentNameTaken } from "@/lib/agents/errors"
import { reportFailure } from "./failure-report.server.ts"
import { exposeError, runEffect } from "./server-fn.server.ts"
import { ServerRequest, tryPromiseInServerRequest } from "./server-request.server.ts"

// A database socket settles a query in the context that opened it, not the caller's.
const outsideAnyRequest = AsyncLocalStorage.snapshot()
const resumeOutsideRequest = Effect.callback<void>((resume) => {
  outsideAnyRequest(() => setTimeout(() => resume(Effect.void), 1))
})

/** Answers one request through TanStack's event storage, as its server function handler does. */
function serveServerFn(effect: Effect.Effect<unknown, unknown, ServerRequest>) {
  return requestHandler(async () => {
    const outcome = await runEffect(effect, "testServerFn").then(
      () => "ok",
      (error: Error) => error.message,
    )
    return new Response(outcome, { status: getResponseStatus() })
  })(new Request("http://localhost/_serverFn/test"), undefined)
}

describe("runEffect", () => {
  it("answers its own request after the fiber resumes outside it", async () => {
    const response = await serveServerFn(
      Effect.gen(function* () {
        yield* resumeOutsideRequest
        const server = yield* ServerRequest
        yield* server.setHeaders({ "Retry-After": "7" })
        yield* server.setCookie("operator_session", "token", { httpOnly: true, path: "/" })
        yield* resumeOutsideRequest
        // Better Auth's cookie plugin calls TanStack's `setCookie` inside its own Promise.
        yield* tryPromiseInServerRequest(() =>
          Promise.resolve(setCookie("session_token", "refreshed")),
        )
      }),
    )
    expect(await response.text()).toBe("ok")
    expect(response.headers.get("retry-after")).toBe("7")
    expect(response.headers.getSetCookie()).toEqual([
      "operator_session=token; Path=/; HttpOnly",
      "session_token=refreshed; Path=/",
    ])
  })

  it("never answers another in-flight request whose socket settles the fiber", async () => {
    let releaseOther: () => void = () => {}
    let insideOther: ((evaluate: () => void) => void) | undefined
    const otherStarted = Promise.withResolvers<void>()
    const other = requestHandler(async () => {
      insideOther = AsyncLocalStorage.snapshot()
      otherStarted.resolve()
      await new Promise<void>((resolve) => (releaseOther = resolve))
      return new Response("other")
    })(new Request("http://localhost/_serverFn/other"), undefined)
    await otherStarted.promise
    // The query's socket was opened by the other request, so its callback resumes there.
    const resumeInOther = Effect.callback<void>((resume) => {
      insideOther!(() => setTimeout(() => resume(Effect.void), 1))
    })
    const response = await serveServerFn(
      resumeInOther.pipe(
        Effect.andThen(
          tryPromiseInServerRequest(() => Promise.resolve(setCookie("session_token", "mine"))),
        ),
      ),
    )
    releaseOther()
    expect(response.headers.getSetCookie()).toEqual(["session_token=mine; Path=/"])
    expect((await other).headers.getSetCookie()).toEqual([])
  })

  it("throws an exposed failure as its tag and user-safe message with its status", async () => {
    const response = await serveServerFn(
      Effect.fail(new AgentNameTaken()).pipe(
        Effect.tap(() => resumeOutsideRequest),
        Effect.catchTag("AgentNameTaken", exposeError),
      ),
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

describe("reportFailure", () => {
  it("logs the failure's type, SQLSTATE and frames once, never its message", async () => {
    const lines: string[] = []
    const logger = Logger.layer([Logger.map(Logger.formatJson, (line) => lines.push(line))])
    const query = new EffectDrizzleQueryError({
      query: "insert into agent values ($1)",
      params: ["sk-secret-value"],
      cause: { code: "08006" },
    })
    const referenceId = await Effect.runPromise(
      Effect.die(query).pipe(
        Effect.catchCause((cause) => reportFailure("createAgent", cause)),
        Effect.provide(logger),
      ),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(referenceId)
    expect(lines[0]).toContain('"sqlstate":"08006"')
    expect(lines[0]).toContain('"type":"EffectDrizzleQueryError"')
    expect(lines[0]).not.toContain("sk-secret-value")
    expect(lines[0]).not.toContain("insert into agent")
  })
})
