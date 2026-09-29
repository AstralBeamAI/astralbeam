import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { Effect, Logger } from "effect"
import { beforeEach, describe, expect, it, vi } from "vitest"

const response = vi.hoisted(() => ({ setResponseStatus: vi.fn() }))

vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => new Request("http://localhost/_serverFn"),
  setResponseStatus: response.setResponseStatus,
}))

import { AgentNameTaken } from "@/lib/agents/errors"
import { reportFailure } from "./failure-report.server.ts"
import { exposeError, runEffect } from "./server-fn.server.ts"

describe("runEffect", () => {
  beforeEach(() => response.setResponseStatus.mockReset())

  it("throws an exposed failure as its tag and user-safe message with its status", async () => {
    const effect = Effect.fail(new AgentNameTaken()).pipe(
      Effect.catchTag("AgentNameTaken", exposeError),
    )
    await expect(runEffect(effect, "createAgent")).rejects.toThrow(
      "[AgentNameTaken] An agent with this name already exists",
    )
    expect(response.setResponseStatus).toHaveBeenCalledWith(409)
  })

  it("hides unexposed failures and defects behind a reference", async () => {
    await expect(runEffect(Effect.fail(new AgentNameTaken()), "createAgent")).rejects.toThrow(
      /^\[InternalError\] Something went wrong\. Reference: [0-9a-f]{8}$/,
    )
    await expect(runEffect(Effect.die(new Error("boom")), "createAgent")).rejects.toThrow(
      /^\[InternalError\]/,
    )
    expect(response.setResponseStatus).toHaveBeenLastCalledWith(500)
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
