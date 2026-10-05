import { useDebouncedValue } from "@tanstack/react-pacer"
import { QueryClient, QueryClientContext, useInfiniteQuery } from "@tanstack/react-query"
import { useContext, useId, useRef, useState, type ReactNode } from "react"
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
  const [open, setOpen] = useState(false)
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  const sharedClient = useContext(QueryClientContext)
  const [client] = useState(() => new QueryClient())
  const queryId = useId()
  const query = useInfiniteQuery(
    {
      queryKey: ["search-dropdown", queryId, search],
      enabled: open && !!loadPage,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) => loadPage!(search, pageParam, signal),
      getNextPageParam: (page) => page.page_after ?? undefined,
      retry: false,
      gcTime: 0,
    },
    sharedClient ?? client,
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
        value={value}
        // Clearing selection while typing must not erase the query. Other modes use Base UI's input state.
        inputValue={clearOnSearch ? text || (value ? itemLabel(value) : "") : undefined}
        onValueChange={onValueChange}
        itemToStringLabel={itemLabel}
        itemToStringValue={(item) => item.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        disabled={disabled}
        onInputValueChange={(next, details) => {
          if (details.reason === "input-change") {
            setText(next)
            if (clearOnSearch) onValueChange(null)
          } else {
            setText("")
          }
        }}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setText("")
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
        <ComboboxContent
          container={container}
          aria-label={popup ? label : undefined}
          aria-busy={loadPage && (searching || query.isFetching) ? true : undefined}
        >
          {popup && input}
          <ComboboxStatus className="text-center text-sm text-muted-foreground [&:not(:empty)]:py-2">
            {loadPage && (searching || query.isFetchingNextPage) ? "Loading…" : null}
          </ComboboxStatus>
          <ComboboxEmpty>
            {!searching && !(loadPage && query.isError) ? "No matches." : null}
          </ComboboxEmpty>
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
              <Button
                variant="ghost"
                size="sm"
                disabled={query.isFetching}
                onClick={() =>
                  void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
                }
              >
                Retry
              </Button>
            </div>
          )}
          {loadPage && !searching && !query.isError && query.hasNextPage && (
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
