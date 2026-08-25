import { createHash } from "node:crypto"

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const operatorSessionTestState = vi.hoisted(() => ({
  tableExists: false,
  inserted: [] as Record<string, unknown>[],
  selectRows: [] as { dbUsername: string; expiresAt: Date }[],
}))

function currentExpiry() {
  return new Date(Date.now() + OPERATOR_SESSION_TTL_SECONDS * 1000)
}

function missingTableError() {
  return Object.assign(new Error("relation does not exist"), { code: "42P01" })
}

vi.mock("@/db/index.server", () => ({
  db: {
    insert: () => ({
      values: (row: Record<string, unknown>) => {
        const execute = () => {
          if (!operatorSessionTestState.tableExists) return Promise.reject(missingTableError())
          operatorSessionTestState.inserted.push(row)
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
          operatorSessionTestState.tableExists
            ? Promise.resolve(operatorSessionTestState.selectRows)
            : Promise.reject(missingTableError()),
      }),
    }),
    delete: () => ({
      where: () =>
        operatorSessionTestState.tableExists
          ? Promise.resolve()
          : Promise.reject(missingTableError()),
    }),
  },
}))

import { createOperatorSession, verifyOperatorSession } from "./operator-session.server"
import { OPERATOR_SESSION_TTL_SECONDS } from "./constants.server"

describe("operator session boundary", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    operatorSessionTestState.tableExists = false
    operatorSessionTestState.inserted = []
    operatorSessionTestState.selectRows = []
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test("bootstrap sessions verify in memory and reject other tokens", async () => {
    const token = await createOperatorSession("astralbeam")
    await expect(verifyOperatorSession(token)).resolves.toEqual({
      dbUsername: "astralbeam",
      expiresAt: currentExpiry(),
    })
    await expect(verifyOperatorSession("not-the-token")).resolves.toBeNull()
    await expect(verifyOperatorSession(undefined)).resolves.toBeNull()
  })

  test("expired bootstrap sessions are rejected", async () => {
    const token = await createOperatorSession("astralbeam")
    vi.advanceTimersByTime((OPERATOR_SESSION_TTL_SECONDS + 1) * 1000)
    await expect(verifyOperatorSession(token)).resolves.toBeNull()
  })

  test("database sessions store only a token hash", async () => {
    operatorSessionTestState.tableExists = true
    const token = await createOperatorSession("astralbeam")
    expect(operatorSessionTestState.inserted).toHaveLength(1)
    const stored = operatorSessionTestState.inserted[0]
    expect(stored?.tokenHash).toBe(createHash("sha256").update(token).digest("hex"))
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  test("bootstrap sessions move into the database once the table exists", async () => {
    const token = await createOperatorSession("astralbeam")
    const tokenHash = createHash("sha256").update(token).digest("hex")
    expect(operatorSessionTestState.inserted).toHaveLength(0)

    operatorSessionTestState.tableExists = true
    await expect(verifyOperatorSession(token)).resolves.toEqual({
      dbUsername: "astralbeam",
      expiresAt: currentExpiry(),
    })
    expect(operatorSessionTestState.inserted.some((row) => row.tokenHash === tokenHash)).toBe(true)

    // The memory copy is gone: verification now depends on the database row alone.
    operatorSessionTestState.selectRows = []
    await expect(verifyOperatorSession(token)).resolves.toBeNull()
    operatorSessionTestState.selectRows = [{
      dbUsername: "astralbeam",
      expiresAt: currentExpiry(),
    }]
    await expect(verifyOperatorSession(token)).resolves.toEqual({
      dbUsername: "astralbeam",
      expiresAt: currentExpiry(),
    })
  })
})
