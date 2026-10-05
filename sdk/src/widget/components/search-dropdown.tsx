import { useDebouncedValue } from "@tanstack/react-pacer"
import { QueryClient, QueryClientContext, useInfiniteQuery } from "@tanstack/react-query"
import { useContext, useEffect, useId, useRef, useState } from "react"
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
  loadPage,
  disabled = false,
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
  loadPage: (
    q: string,
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<{
    items: T[]
    page_after: string | null
  }>
  disabled?: boolean
  showClear?: boolean
  popup?: boolean
  id?: string
  className?: string
}) {
  const container = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  const sharedClient = useContext(QueryClientContext)
  const [client] = useState(() => new QueryClient())
  const queryId = useId()
  const query = useInfiniteQuery(
    {
      queryKey: ["search-dropdown", queryId, search],
      enabled: open,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) => loadPage(search, pageParam, signal),
      getNextPageParam: (page) => page.page_after ?? undefined,
      retry: false,
      gcTime: 0,
    },
    sharedClient ?? client,
  )
  const searching = text.trim() !== search || query.isPending
  const { hasNextPage, isFetching, isError, fetchNextPage } = query
  useEffect(() => {
    const element = list.current
    if (!open || !element || searching || !hasNextPage || isFetching || isError) return
    const loadNextPage = () => {
      if (element.scrollHeight - element.scrollTop - element.clientHeight < 48)
        void fetchNextPage({ cancelRefetch: false })
    }
    // Short pages must load the next page even when there is no overflow to scroll yet.
    loadNextPage()
    element.addEventListener("scroll", loadNextPage)
    return () => element.removeEventListener("scroll", loadNextPage)
  }, [open, searching, hasNextPage, isFetching, isError, fetchNextPage, query.data])
  const choices = searching ? [] : (query.data?.pages.flatMap((page) => page.items) ?? [])
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
        filteredItems={choices}
        value={value}
        onValueChange={onValueChange}
        itemToStringLabel={itemLabel}
        itemToStringValue={(item) => item.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        disabled={disabled}
        onInputValueChange={(next, details) => {
          setText(details.reason === "input-change" ? next : "")
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
          aria-busy={searching || query.isFetching ? true : undefined}
        >
          {popup && input}
          <ComboboxStatus className="text-center text-sm text-muted-foreground [&:not(:empty)]:py-2">
            {searching || query.isFetchingNextPage ? "Loading…" : null}
          </ComboboxStatus>
          <ComboboxEmpty>{!searching && !query.isError ? "No matches." : null}</ComboboxEmpty>
          <ComboboxList ref={list}>
            {(item: T) => (
              <ComboboxItem key={item.id} value={item}>
                {itemLabel(item)}
              </ComboboxItem>
            )}
          </ComboboxList>
          {!searching && query.isError && (
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
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
