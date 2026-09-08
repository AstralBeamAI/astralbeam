import { Effect, Option, Stream } from "effect"

export interface DatabasePageOptions {
  pageSize?: number | undefined
  position?: { id: string } | undefined
  backward?: boolean | undefined
}

export interface DatabasePage<T> {
  items: T[]
  nextPosition: { id: string } | null
}

export function databasePages<T extends { id: string }, E, R>(
  { pageSize = 20, position, backward = false }: DatabasePageOptions,
  fetchPage: (
    position: DatabasePageOptions["position"],
    pageSize: number,
  ) => Effect.Effect<T[], E, R>,
) {
  return Stream.paginate(
    position,
    (position) =>
      fetchPage(position, pageSize).pipe(Effect.map((rows) => {
        const items = rows.slice(0, pageSize)
        const nextPosition = rows.length > pageSize ? { id: items.at(-1)!.id } : null
        if (backward) items.reverse()
        const page: DatabasePage<T> = { items, nextPosition }
        return [[page], Option.fromNullishOr(nextPosition)] as const
      })),
  )
}
