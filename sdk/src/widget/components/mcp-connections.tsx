import {
  ArrowsClockwiseIcon,
  PlugIcon,
  PulseIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react"
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { McpConnectionOperation } from "../../core/mcp.ts"
import { TooltipButton } from "./tooltip-button.tsx"
import { Button } from "./ui/button.tsx"
import { Field, FieldDescription, FieldLabel } from "./ui/field.tsx"
import { Input } from "./ui/input.tsx"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia } from "./ui/item.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx"

export function McpConnectionsPanel({
  chat,
  state,
}: {
  chat: AstralBeamChatCore
  state: AstralBeamChatState
}) {
  const fieldId = useId()
  const container = useRef<HTMLDivElement>(null)
  const [client] = useState(() => new QueryClient())
  const [open, setOpen] = useState(false)
  const [headersFor, setHeadersFor] = useState<string | null>(null)
  const [activeServerId, setActiveServerId] = useState<string>()
  const identity =
    state.auth.status === "ready" && state.auth.currentUser.scope === "tenant"
      ? state.auth.currentUser
      : null
  const catalog = useQuery(
    {
      queryKey: [
        "mcp-connections",
        identity?.organization.id,
        identity?.tenant.id,
        identity?.user.id,
      ],
      enabled: open && !!identity,
      queryFn: () => chat.getMcpCatalog(),
      retry: false,
    },
    client,
  )
  const mutation = useMutation(
    {
      mutationFn: (
        operation:
          | McpConnectionOperation
          | { action: "authorize"; mcpServerId: string; id?: string },
      ) =>
        operation.action === "authorize"
          ? chat.authorizeMcpConnection(operation)
          : chat.manageMcpConnection(operation),
      onMutate: (operation) => {
        setActiveServerId(
          "mcpServerId" in operation
            ? operation.mcpServerId
            : catalog.data?.connections.find((entry) => entry.id === operation.id)?.mcp_server_id,
        )
      },
      onSuccess: () => setHeadersFor(null),
      onSettled: () => catalog.refetch(),
    },
    client,
  )
  if (!identity) return null
  const busy = mutation.isPending
  const servers = catalog.isError ? undefined : catalog.data?.servers
  const pendingLabel = busy
    ? {
        authorize: "Waiting for sign-in…",
        test: "Testing connection…",
        disconnect: "Disconnecting…",
        connect: "Enabling…",
        headers: "Saving credentials…",
      }[mutation.variables.action]
    : null
  const notice = mutation.isError
    ? mutation.error.message
    : mutation.isSuccess
      ? mutation.variables.action === "test" && mutation.data && "tool_count" in mutation.data
        ? `${mutation.data.tool_count} tools available.`
        : mutation.variables.action === "disconnect"
          ? "Disconnected locally."
          : "Connection saved."
      : null
  return (
    <div ref={container}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<TooltipButton variant="ghost" size="icon-sm" tooltip="MCP connections" />}
        >
          <PlugIcon />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          align="end"
          aria-labelledby={`${fieldId}-title`}
          className="max-h-[75vh] w-[min(24rem,85vw)] gap-0 overflow-hidden p-0"
        >
          <header className="shrink-0 border-b px-3 py-2">
            <h2 id={`${fieldId}-title`} className="font-semibold">
              MCP connections
            </h2>
          </header>
          <div className="min-h-0 divide-y overflow-y-auto">
            {catalog.isPending && (
              <p role="status" className="px-3 py-2 text-xs">
                Loading servers…
              </p>
            )}
            {catalog.isError && (
              <div className="px-3 py-2">
                <p role="alert" className="text-xs text-destructive">
                  {catalog.error.message}
                </p>
                <Button
                  size="sm"
                  className="any-pointer-coarse:min-h-9"
                  onClick={() => void catalog.refetch()}
                >
                  Try again
                </Button>
              </div>
            )}
            {servers?.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No MCP servers are available.
              </p>
            )}
            {servers?.map((server) => {
              const connection = catalog.data?.connections.find(
                (entry) => entry.mcp_server_id === server.id,
              )
              const connected = connection?.auth_state === "connected"
              const publicServer = server.auth_kind === "none"
              const active = activeServerId === server.id
              const StatusIcon = busy && active ? SpinnerGapIcon : PlugIcon
              const endpoint = new URL(server.endpoint_url)
              const disconnectLabel = publicServer
                ? "Disable"
                : connection?.auth_state === "disconnected"
                  ? "Remove connection"
                  : "Disconnect"
              const labels = server.auth_kind
                ? (
                    {
                      none: ["Enable", "Enable"],
                      oauth: ["Connect", "Reconnect"],
                      static_headers: ["Connect", "Replace credentials"],
                    } as const
                  )[server.auth_kind]
                : null
              return (
                <Item
                  key={server.id}
                  render={<article />}
                  size="xs"
                  data-slot="mcp-connection"
                  className="rounded-none border-0 py-1.5"
                >
                  <ItemMedia variant="icon" className="text-muted-foreground">
                    <StatusIcon
                      aria-hidden="true"
                      className={busy && active ? "animate-spin" : undefined}
                    />
                  </ItemMedia>
                  <ItemContent className="min-w-0" title={server.endpoint_url}>
                    <h3 className="truncate text-sm font-medium">{endpoint.hostname}</h3>
                    <ItemDescription role="status" className="line-clamp-none truncate">
                      {active && pendingLabel
                        ? pendingLabel
                        : active && mutation.isError && mutation.variables.action === "test"
                          ? "Connection failed"
                          : connected
                            ? publicServer
                              ? "Enabled"
                              : "Connected"
                            : connection?.auth_state === "reauthorization_required"
                              ? "Reconnect needed"
                              : publicServer
                                ? "Disabled"
                                : "Not connected"}
                      {" · "}
                      {endpoint.pathname}
                      {endpoint.search}
                    </ItemDescription>
                  </ItemContent>
                  {headersFor !== server.id && (
                    <ItemActions className="shrink-0 gap-0.5">
                      {labels && !(publicServer && connected) && (
                        <TooltipButton
                          size={connected ? "icon-sm" : "xs"}
                          className={connected ? undefined : "any-pointer-coarse:min-h-9"}
                          variant={connected ? "ghost" : "outline"}
                          aria-label={`${labels[connected ? 1 : 0]}: ${endpoint.hostname}`}
                          tooltip={labels[connected ? 1 : 0]}
                          disabled={busy}
                          onClick={() =>
                            server.auth_kind === "oauth"
                              ? mutation.mutate({
                                  action: "authorize",
                                  mcpServerId: server.id,
                                  ...(connection ? { id: connection.id } : {}),
                                })
                              : server.auth_kind === "static_headers"
                                ? setHeadersFor(server.id)
                                : mutation.mutate({ action: "connect", mcpServerId: server.id })
                          }
                        >
                          {connected ? <ArrowsClockwiseIcon /> : labels[0]}
                        </TooltipButton>
                      )}
                      {connected && connection && (
                        <TooltipButton
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Test connection: ${endpoint.hostname}`}
                          tooltip="Test connection"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "test", id: connection.id })}
                        >
                          <PulseIcon />
                        </TooltipButton>
                      )}
                      {connection && (
                        <TooltipButton
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`${disconnectLabel}: ${endpoint.hostname}`}
                          tooltip={disconnectLabel}
                          disabled={busy}
                          onClick={() =>
                            mutation.mutate({ action: "disconnect", id: connection.id })
                          }
                        >
                          <XIcon />
                        </TooltipButton>
                      )}
                    </ItemActions>
                  )}
                  {!server.auth_kind && (
                    <p className="basis-full text-xs text-destructive">
                      Configuration unavailable. Contact your administrator.
                    </p>
                  )}
                  {headersFor === server.id && (
                    <form
                      className="grid basis-full gap-2"
                      onSubmit={(event) => {
                        event.preventDefault()
                        const fields = new FormData(event.currentTarget)
                        mutation.mutate({
                          action: "headers",
                          mcpServerId: server.id,
                          headers: Object.fromEntries(
                            server.header_names.map((name) => [name, fields.get(name) as string]),
                          ),
                        })
                      }}
                    >
                      <fieldset disabled={busy} className="grid gap-2">
                        {server.header_names.map((name) => (
                          <Field key={name} className="gap-1">
                            <FieldLabel
                              className="text-xs"
                              htmlFor={`${fieldId}-${server.id}-${name}`}
                            >
                              {name} value
                            </FieldLabel>
                            <Input
                              className="any-pointer-coarse:min-h-11 any-pointer-coarse:text-base"
                              id={`${fieldId}-${server.id}-${name}`}
                              name={name}
                              type="password"
                              autoComplete="off"
                              required
                              aria-describedby={
                                name.toLowerCase() === "authorization"
                                  ? `${fieldId}-authorization-help`
                                  : undefined
                              }
                            />
                            {name.toLowerCase() === "authorization" && (
                              <FieldDescription
                                id={`${fieldId}-authorization-help`}
                                className="text-xs"
                              >
                                Enter the full value, including Bearer before the token when
                                required.
                              </FieldDescription>
                            )}
                          </Field>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Saved secrets are never shown. Enter every value to replace them.
                        </p>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" className="any-pointer-coarse:min-h-9">
                            Save credentials
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="any-pointer-coarse:min-h-9"
                            variant="outline"
                            onClick={() => setHeadersFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </fieldset>
                    </form>
                  )}
                  {active && notice && (
                    <p
                      data-slot="mcp-notice"
                      role={mutation.isError ? "alert" : "status"}
                      className={
                        mutation.isError
                          ? "basis-full text-xs text-destructive"
                          : "basis-full text-xs text-muted-foreground"
                      }
                    >
                      {notice}
                    </p>
                  )}
                  {connected &&
                    connection &&
                    state.unavailableMcpConnections?.includes(connection.id) && (
                      <p className="basis-full text-xs text-muted-foreground">
                        Unavailable in the last chat. Test the connection or reconnect.
                      </p>
                    )}
                </Item>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
