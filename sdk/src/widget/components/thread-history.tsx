import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react"
import { useDebouncedValue } from "@tanstack/react-pacer"
import { QueryClient, QueryClientContext, useInfiniteQuery } from "@tanstack/react-query"
import { type SyntheticEvent, useContext, useEffect, useId, useRef, useState } from "react"
import { cn } from "cn"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { ChatThread } from "../../core/threads.ts"
import { Button } from "./ui/button.tsx"
import {
  Combobox,
  ComboboxCollection,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxStatus,
} from "./ui/combobox.tsx"

interface ThreadGroup {
  value: string
  items: ChatThread[]
}

function activityGroup(updatedAt: string, now: Date): string {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(new Date(updatedAt))) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return "Previous 7 days"
  if (days < 30) return "Previous 30 days"
  return "Older"
}

// The server lists the most recently active threads first, so equal labels are always adjacent.
function groupThreads(threads: ChatThread[]): ThreadGroup[] {
  const now = new Date()
  const groups: ThreadGroup[] = []
  for (const thread of threads) {
    const value = activityGroup(thread.updatedAt, now)
    const last = groups.at(-1)
    if (last?.value === value) last.items.push(thread)
    else groups.push({ value, items: [thread] })
  }
  return groups
}

const threadTitle = (thread: ChatThread) => thread.title || "Untitled"

// Keeps the delete button's press from also selecting the row it sits in.
const stopRowEvent = (event: SyntheticEvent) => event.stopPropagation()

export function ThreadHistory({
  chat,
  state,
  onSelect,
  onDelete,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
  onSelect: () => void
  onDelete: (threadId: string) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  // Each opening fetches afresh, since the title bar can rename or delete chats while it is closed.
  const [openings, setOpenings] = useState(0)
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  const sharedClient = useContext(QueryClientContext)
  const [client] = useState(() => new QueryClient())
  const queryId = useId()
  const query = useInfiniteQuery(
    {
      queryKey: ["thread-history", queryId, openings, search],
      enabled: open,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) => chat.searchThreads(search, pageParam, signal),
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
  const groups = searching
    ? []
    : groupThreads(query.data?.pages.flatMap((page) => page.items) ?? [])
  const currentId = state.thread?.id
  const writing = state.status === "submitted" || state.status === "streaming"
  const deleteThread = (thread: ChatThread) => {
    void chat.deleteThread(thread).then((deleted) => {
      if (!deleted) return
      onDelete(thread.id)
      void query.refetch()
    })
  }
  return (
    <div ref={container} data-slot="thread-history">
      <Combobox
        items={groups}
        filteredItems={groups}
        value={null}
        onValueChange={(thread: ChatThread | null) => {
          if (!thread || thread.id === currentId) return
          void chat.openThread(thread.id).then(onSelect)
        }}
        itemToStringLabel={threadTitle}
        itemToStringValue={(thread) => thread.id}
        isItemEqualToValue={(a, b) => a.id === b.id}
        onInputValueChange={(next, details) => {
          setText(details.reason === "input-change" ? next : "")
        }}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setOpenings((count) => count + 1)
          else setText("")
        }}
      >
        <ComboboxPrimitive.Trigger
          aria-label="Show older chats"
          title="Show older chats"
          render={<Button variant="ghost" size="icon-sm" />}
        >
          <ClockCounterClockwiseIcon />
        </ComboboxPrimitive.Trigger>
        <ComboboxContent
          container={container}
          align="end"
          aria-label="Chat history"
          aria-busy={searching || query.isFetching ? true : undefined}
          className="w-80 min-w-0"
        >
          <ComboboxInput
            aria-label="Search chats"
            placeholder="Search chats…"
            maxLength={255}
            showTrigger={false}
          />
          <ComboboxStatus className="text-center text-sm text-muted-foreground [&:not(:empty)]:py-2">
            {searching || query.isFetchingNextPage ? "Loading…" : null}
          </ComboboxStatus>
          <ComboboxEmpty>{!searching && !query.isError ? "No chats found." : null}</ComboboxEmpty>
          <ComboboxList
            ref={list}
            className="max-h-[min(24rem,calc(var(--available-height)---spacing(9)))]"
          >
            {(group: ThreadGroup) => (
              <ComboboxGroup key={group.value} items={group.items}>
                <ComboboxLabel>{group.value}</ComboboxLabel>
                <ComboboxCollection>
                  {(thread: ChatThread) => {
                    const current = thread.id === currentId
                    return (
                      <ComboboxItem
                        key={thread.id}
                        value={thread}
                        // Keeps the delete button's label out of the option's accessible name.
                        aria-label={threadTitle(thread)}
                        aria-current={current ? "true" : undefined}
                        className={cn(
                          "group/thread ps-2 pe-1",
                          current && "bg-muted font-semibold",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{threadTitle(thread)}</span>
                        {thread.role === "manager" && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${threadTitle(thread)}`}
                            title="Delete"
                            disabled={current && writing}
                            className="opacity-0 group-hover/thread:opacity-100 group-data-highlighted/thread:opacity-100 focus-visible:opacity-100"
                            onPointerDown={stopRowEvent}
                            onMouseDown={stopRowEvent}
                            onClick={(event) => {
                              event.stopPropagation()
                              deleteThread(thread)
                            }}
                          >
                            <TrashIcon />
                          </Button>
                        )}
                      </ComboboxItem>
                    )
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
          {!searching && query.isError && (
            <div className="p-2 text-xs" role="alert">
              Could not load chats.
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
