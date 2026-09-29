import { Effect } from "effect"

export interface DatabasePageOptions {
  readonly pageSize?: number | undefined
  readonly position?: { readonly id: string } | undefined
  readonly backward?: boolean | undefined
}

export interface DatabasePage<T> {
  readonly items: T[]
  readonly nextPosition: { readonly id: string } | null
  /** Null means no page in the opposite direction. */
  readonly previousPosition: { readonly id: string } | null
}

/**
 * Reads one keyset page past `position`, one extra row to detect a next page, and probes the
 * opposite direction only when a cursor was given. Backward pages keep display order.
 */
export const databasePage = Effect.fnUntraced(function* <T extends { readonly id: string }, R>(
  { pageSize = 20, position, backward = false }: DatabasePageOptions,
  fetchRows: (
    position: DatabasePageOptions["position"],
    limit: number,
    backward: boolean,
  ) => Effect.Effect<T[], never, R>,
) {
  const rows = yield* fetchRows(position, pageSize + 1, backward)
  const items = rows.slice(0, pageSize)
  const nextPosition = rows.length > pageSize ? { id: items.at(-1)!.id } : null
  const boundary = items[0]
  const previousPosition =
    position && boundary && (yield* fetchRows({ id: boundary.id }, 1, !backward)).length > 0
      ? { id: boundary.id }
      : null
  if (backward) items.reverse()
  return { items, nextPosition, previousPosition } satisfies DatabasePage<T>
})
