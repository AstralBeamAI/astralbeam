import { Effect } from "effect"

export interface DatabasePageOptions {
  readonly pageSize?: number | undefined
  readonly position?: { readonly id: string; readonly updatedAt?: string } | undefined
  readonly backward?: boolean | undefined
}

export interface DatabasePage<T> {
  readonly items: T[]
  readonly nextPosition: { readonly id: string; readonly updatedAt?: string } | null
  /** Null means no page in the opposite direction. */
  readonly previousPosition: { readonly id: string; readonly updatedAt?: string } | null
}

/**
 * Reads one keyset page past `position`, one extra row to detect a next page, and probes the
 * opposite direction only when a cursor was given. Backward pages keep display order.
 */
export const databasePage = Effect.fnUntraced(function* <T extends { readonly id: string }, E, R>(
  { pageSize = 20, position, backward = false }: DatabasePageOptions,
  fetchRows: (
    position: DatabasePageOptions["position"],
    limit: number,
    backward: boolean,
  ) => Effect.Effect<T[], E, R>,
  positionFor: (row: T) => NonNullable<DatabasePageOptions["position"]> = (row) => ({ id: row.id }),
) {
  const rows = yield* fetchRows(position, pageSize + 1, backward)
  const items = rows.slice(0, pageSize)
  const nextPosition = rows.length > pageSize ? positionFor(items.at(-1)!) : null
  const boundary = items[0]
  const previousPosition =
    position && boundary && (yield* fetchRows(positionFor(boundary), 1, !backward)).length > 0
      ? positionFor(boundary)
      : null
  if (backward) items.reverse()
  return { items, nextPosition, previousPosition } satisfies DatabasePage<T>
})
