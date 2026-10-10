import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { databasePage, type DatabasePageOptions } from "./pagination"

describe("database keyset pagination", () => {
  it.effect("preserves compound boundaries in both directions when timestamps tie", () =>
    Effect.gen(function* () {
      const rows = [
        { id: "e", updatedAt: "2026-10-05T12:00:00.000Z" },
        { id: "d", updatedAt: "2026-10-05T12:00:00.000Z" },
        { id: "c", updatedAt: "2026-10-05T12:00:00.000Z" },
        { id: "b", updatedAt: "2026-10-04T12:00:00.000Z" },
        { id: "a", updatedAt: "2026-10-03T12:00:00.000Z" },
      ]
      const page = (options: DatabasePageOptions) =>
        databasePage(
          { pageSize: 2, ...options },
          (position, limit, backward) =>
            Effect.sync(() => {
              const matching = rows.filter((row) => {
                if (!position) return true
                const order =
                  row.updatedAt.localeCompare(position.updatedAt ?? "") ||
                  row.id.localeCompare(position.id)
                return backward ? order > 0 : order < 0
              })
              return (backward ? matching.reverse() : matching).slice(0, limit)
            }),
          (row) => row,
        )
      const first = yield* page({})
      const middle = yield* page({ position: first.nextPosition! })
      const last = yield* page({ position: middle.nextPosition! })
      assert.deepStrictEqual([...first.items, ...middle.items, ...last.items], rows)
      assert.isNull(first.previousPosition)
      assert.isNull(last.nextPosition)
      const previous = yield* page({ position: middle.previousPosition!, backward: true })
      assert.deepStrictEqual(previous.items, first.items)
      assert.isNull(previous.nextPosition)
    }),
  )
})
