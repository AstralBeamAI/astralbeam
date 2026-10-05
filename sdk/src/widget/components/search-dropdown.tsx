import { useDebouncedValue } from "@tanstack/react-pacer"
import { QueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { useRef, useState, type ReactNode } from "react"
import { Button } from "./ui/button.tsx"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxStatus,
  ComboboxTrigger,
  ComboboxValue,
} from "./ui/combobox.tsx"

export function SearchDropdown<T extends { id: string }>({
  label,
  placeholder = "Search…",
  value,
  onValueChange,
  itemLabel,
  renderItem = itemLabel,
  items = [],
  loadPage,
  disabled = false,
  itemDisabled,
  clearOnSearch = false,
  showClear = false,
  popup = false,
  id,
  className = "min-w-0 flex-1",
}: {
  label: string
  placeholder?: string
  value: T | null
  onValueChange: (item: T | null) => void
  itemLabel: (item: T) => string
  renderItem?: (item: T) => ReactNode
  items?: readonly T[]
  loadPage?: (
    q: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<{
    items: T[]
    page_after: string | null
  }>
  disabled?: boolean
  itemDisabled?: (item: T) => boolean
  clearOnSearch?: boolean
  showClear?: boolean
  popup?: boolean
  id?: string
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const [text, setText] = useState("")
  const [editing, setEditing] = useState(false)
  const [open, setOpen] = useState(false)
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  // A private query cache prevents options from crossing identity or resource scopes.
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  const query = useInfiniteQuery(
    {
      queryKey: ["search-dropdown", search],
      enabled: open && !!loadPage,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) => loadPage!(search, pageParam, signal),
      getNextPageParam: (page) => page.page_after ?? undefined,
    },
    client,
  )
  const searching = !!loadPage && (text.trim() !== search || query.isPending)
  const choices = loadPage
    ? searching
      ? []
      : (query.data?.pages.flatMap((page) => page.items) ?? [])
    : items
  const input = (
    <ComboboxInput
      id={popup ? undefined : id}
      aria-label={popup ? placeholder : label}
      placeholder={placeholder}
      maxLength={255}
      disabled={disabled}
      showTrigger={!popup}
      showClear={showClear}
      onFocus={(event) => event.currentTarget.select()}
    />
  )
  return (
    <div ref={container} className={className} data-slot="search-dropdown">
      <Combobox
        items={
          value && !choices.some((item) => item.id === value.id) ? [...choices, value] : choices
        }
        filteredItems={loadPage ? choices : undefined}
        filter={loadPage ? null : undefined}
        value={value}
        inputValue={popup || editing ? text : value ? itemLabel(value) : ""}
        onValueChange={(item) => {
          setEditing(false)
          setText("")
          onValueChange(item)
        }}
        itemToStringLabel={itemLabel}
        itemToStringValue={(item) => item.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        disabled={disabled}
        onInputValueChange={(next, details) => {
          if (popup || details.reason === "input-change" || details.reason === "clear-press") {
            setEditing(true)
            setText(next)
            if (clearOnSearch || details.reason === "clear-press") onValueChange(null)
          }
        }}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) {
            setText("")
            setEditing(false)
          }
        }}
      >
        {popup ? (
          <ComboboxTrigger
            id={id}
            aria-label={label}
            render={<Button variant="outline" className="w-full justify-between" />}
          >
            <span className="truncate">
              <ComboboxValue placeholder={label} />
            </span>
          </ComboboxTrigger>
        ) : (
          input
        )}
        <ComboboxContent container={container} aria-label={popup ? label : undefined}>
          {popup && input}
          <ComboboxStatus className="text-center text-sm text-muted-foreground [&:not(:empty)]:py-2">
            {loadPage && (searching || query.isFetchingNextPage) ? "Loading…" : null}
          </ComboboxStatus>
          {!searching && !(loadPage && query.isError) && <ComboboxEmpty>No matches.</ComboboxEmpty>}
          <ComboboxList
            onScroll={(event) => {
              const list = event.currentTarget
              if (
                loadPage &&
                !searching &&
                query.hasNextPage &&
                !query.isFetching &&
                !query.isError &&
                list.scrollHeight - list.scrollTop - list.clientHeight < 48
              ) {
                void query.fetchNextPage()
              }
            }}
          >
            {(item: T) => (
              <ComboboxItem key={item.id} value={item} disabled={itemDisabled?.(item)}>
                {renderItem(item)}
              </ComboboxItem>
            )}
          </ComboboxList>
          {loadPage && !searching && query.isError && (
            <div className="p-2 text-xs" role="alert">
              Could not load options.
              <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                Retry
              </Button>
            </div>
          )}
          {loadPage && !searching && query.hasNextPage && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          )}
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
