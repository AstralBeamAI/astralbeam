import { Combobox as ComboboxPrimitive } from "@base-ui/react"
import { ArrowClockwiseIcon, ClockCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react"
import { useDebouncedValue } from "@tanstack/react-pacer"
import { QueryClient, useInfiniteQuery } from "@tanstack/react-query"
import { type SyntheticEvent, useEffect, useRef, useState } from "react"
import { cn } from "cn"
import { isAstralBeamApiError } from "../../api/api.ts"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { ChatThread } from "../../core/threads.ts"
import { DeleteConversationDialog } from "./delete-conversation-dialog.tsx"
import { TooltipButton } from "./tooltip-button.tsx"
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
  const trigger = useRef<HTMLButtonElement>(null)
  const [deletingThread, setDeletingThread] = useState<ChatThread | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const [text, setText] = useState("")
  const [open, setOpen] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [boundary, setBoundary] = useState<Element>()
  const [search] = useDebouncedValue(text.trim(), { wait: 300 })
  const [client] = useState(() => new QueryClient())
  useEffect(() => {
    client.mount()
    return () => {
      client.unmount()
      client.clear()
    }
  }, [client])
  const authenticated = state.auth.status === "ready"
  const query = useInfiniteQuery(
    {
      queryKey: ["thread-history", search],
      enabled: open && authenticated && !accessDenied,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ signal, pageParam }) =>
        chat.searchThreads(search, pageParam, signal).catch((error: unknown) => {
          if (isAstralBeamApiError(error) && [401, 403, 404].includes(error.status))
            setAccessDenied(true)
          throw error
        }),
      getNextPageParam: (page) => page.page_after ?? undefined,
      retry: false,
      staleTime: 30_000,
      gcTime: 300_000,
    },
    client,
  )
  const currentId = state.thread?.id
  const version = state.thread?.version
  const writing = state.status === "submitted" || state.status === "streaming"
  useEffect(() => {
    if (state.auth.status === "error" || accessDenied)
      client.removeQueries({ queryKey: ["thread-history"] })
  }, [client, state.auth.status, accessDenied])
  useEffect(() => {
    if (!writing) void client.invalidateQueries({ queryKey: ["thread-history"] })
  }, [client, currentId, version, writing])
  const searching = !accessDenied && (text.trim() !== search || query.isPending)
  const failed = accessDenied || (!searching && query.isError)
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
  const groups =
    !authenticated || accessDenied || searching
      ? []
      : groupThreads(query.data?.pages.flatMap((page) => page.items) ?? [])
  return (
    <div ref={container} data-slot="thread-history">
      {deletingThread && (
        <DeleteConversationDialog
          title={threadTitle(deletingThread)}
          container={container}
          finalFocus={trigger}
          onClose={() => setDeletingThread(null)}
          onDelete={async () => {
            const deleted = await chat.deleteThread(deletingThread)
            if (deleted) {
              onDelete(deletingThread.id)
              void client.invalidateQueries({ queryKey: ["thread-history"] })
            }
            return deleted
          }}
        />
      )}
      <Combobox
        open={open}
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
          if (next) {
            setAccessDenied(false)
            setBoundary(container.current?.closest('[data-slot="chat"]') ?? undefined)
          } else setText("")
        }}
      >
        <ComboboxPrimitive.Trigger
          ref={trigger}
          render={
            <TooltipButton
              tooltip="Show older chats"
              variant="ghost"
              size="icon-sm"
              disabled={!authenticated}
            />
          }
        >
          <ClockCounterClockwiseIcon />
        </ComboboxPrimitive.Trigger>
        <ComboboxContent
          container={container}
          collisionBoundary={boundary}
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
            {!failed && (searching || query.isFetchingNextPage) ? "Loading…" : null}
          </ComboboxStatus>
          <ComboboxEmpty>
            {authenticated && !searching && !failed ? "No chats found." : null}
          </ComboboxEmpty>
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
                          "group/thread ps-2 pe-1 any-pointer-coarse:min-h-11",
                          current && "bg-muted font-semibold",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{threadTitle(thread)}</span>
                        {thread.role === "manager" && (
                          <TooltipButton
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Delete ${threadTitle(thread)}`}
                            tooltip="Delete chat"
                            disabled={current && writing}
                            className="opacity-0 group-hover/thread:opacity-100 group-data-highlighted/thread:opacity-100 focus-visible:opacity-100 any-pointer-coarse:opacity-100"
                            onPointerDown={stopRowEvent}
                            onMouseDown={stopRowEvent}
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpen(false)
                              setDeletingThread(thread)
                            }}
                          >
                            <TrashIcon />
                          </TooltipButton>
                        )}
                      </ComboboxItem>
                    )
                  }}
                </ComboboxCollection>
              </ComboboxGroup>
            )}
          </ComboboxList>
          {failed && (
            <div className="p-2 text-xs" role="alert">
              Could not load chats.
              <TooltipButton
                variant="ghost"
                size="icon-sm"
                tooltip="Retry"
                disabled={query.isFetching}
                onClick={() =>
                  void (
                    !accessDenied && query.isFetchNextPageError
                      ? query.fetchNextPage()
                      : query.refetch()
                  ).then((result) => {
                    if (result.isSuccess) setAccessDenied(false)
                  })
                }
              >
                <ArrowClockwiseIcon />
              </TooltipButton>
            </div>
          )}
        </ComboboxContent>
      </Combobox>
    </div>
  )
}
