import { Effect, Option, Stream } from "effect"

export interface DatabasePageOptions {
  pageSize?: number | undefined
  position?: { id: string } | undefined
  backward?: boolean | undefined
  includePrevious?: boolean | undefined
}

export interface DatabasePage<T> {
  items: T[]
  nextPosition: { id: string } | null
  /** Undefined unless includePrevious is enabled; null means no opposite page. */
  previousPosition: { id: string } | null | undefined
}

export function databasePages<T extends { id: string }, E, R>(
  { pageSize = 20, position, backward = false, includePrevious = false }: DatabasePageOptions,
  fetchPage: (
    position: DatabasePageOptions["position"],
    limit: number,
    backward: boolean,
  ) => Effect.Effect<T[], E, R>,
) {
  return Stream.paginate(
    position,
    (position) =>
      Effect.gen(function* () {
        const rows = yield* fetchPage(position, pageSize + 1, backward)
        const items = rows.slice(0, pageSize)
        const nextPosition = rows.length > pageSize ? { id: items.at(-1)!.id } : null
        const boundary = items[0]
        const previousPosition = !includePrevious ? undefined : position && boundary &&
            (yield* fetchPage({ id: boundary.id }, 1, !backward)).length > 0
          ? { id: boundary.id }
          : null
        if (backward) items.reverse()
        const page: DatabasePage<T> = { items, nextPosition, previousPosition }
        return [[page], Option.fromNullishOr(nextPosition)] as const
      }),
  )
}
