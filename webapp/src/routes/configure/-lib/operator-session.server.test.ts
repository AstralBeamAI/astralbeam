import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const state = vi.hoisted(() => ({
  tableExists: false,
  inserted: [] as Record<string, unknown>[],
  selectRows: [] as { dbUsername: string }[],
}))

function missingTableError() {
  return Object.assign(new Error("relation does not exist"), { code: "42P01" })
}

vi.mock("@/db/index.server", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        const execute = () => {
          if (!state.tableExists) return Promise.reject(missingTableError())
          state.inserted.push(row)
          return Promise.resolve()
        }
        return {
          then: (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => execute().then(resolve, reject),
          onConflictDoNothing: () => execute(),
        }
      },
    }),
    select: () => ({
      from: () => ({
        where: () =>
          state.tableExists
            ? Promise.resolve(state.selectRows)
            : Promise.reject(missingTableError()),
      }),
    }),
    delete: () => ({
      where: () => (state.tableExists ? Promise.resolve() : Promise.reject(missingTableError())),
    }),
  },
}))

import { createOperatorSession, verifyOperatorSession } from "./operator-session.server"
import { OPERATOR_SESSION_TTL_SECONDS } from "./constants.server"

describe("operator session boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.tableExists = false
    state.inserted = []
    state.selectRows = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("bootstrap sessions verify in memory and reject other tokens", async () => {
    const token = await createOperatorSession("astralbeam")
    await expect(verifyOperatorSession(token)).resolves.toEqual({ dbUsername: "astralbeam" })
    await expect(verifyOperatorSession("not-the-token")).resolves.toBeNull()
    await expect(verifyOperatorSession(undefined)).resolves.toBeNull()
  })

  test("expired bootstrap sessions are rejected", async () => {
    const token = await createOperatorSession("astralbeam")
    vi.advanceTimersByTime((OPERATOR_SESSION_TTL_SECONDS + 1) * 1000)
    await expect(verifyOperatorSession(token)).resolves.toBeNull()
  })

  test("database sessions store only a token hash", async () => {
    state.tableExists = true
    const token = await createOperatorSession("astralbeam")
    expect(state.inserted).toHaveLength(1)
    const stored = state.inserted[0]
    expect(stored?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"))
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  test("bootstrap sessions move into the database once the table exists", async () => {
    const token = await createOperatorSession("astralbeam")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    expect(state.inserted).toHaveLength(0)

    state.tableExists = true
    await expect(verifyOperatorSession(token)).resolves.toEqual({ dbUsername: "astralbeam" })
    expect(state.inserted.some((row) => row.tokenHash === tokenHash)).toBe(true)

    // The memory copy is gone: verification now depends on the database row alone.
    state.selectRows = []
    await expect(verifyOperatorSession(token)).resolves.toBeNull()
    state.selectRows = [{ dbUsername: "astralbeam" }]
    await expect(verifyOperatorSession(token)).resolves.toEqual({ dbUsername: "astralbeam" })
  })
})
