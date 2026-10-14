import {
  ArrowClockwiseIcon,
  PlugIcon,
  PulseIcon,
  SpinnerGapIcon,
  XIcon,
} from "@phosphor-icons/react"
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { McpManagementOperation } from "../../core/mcp.ts"
import { Button } from "./ui/button.tsx"
import { Input } from "./ui/input.tsx"
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
          | McpManagementOperation
          | { action: "authorize"; mcpServerId: string; id?: string },
      ) =>
        operation.action === "authorize"
          ? chat.connectMcpAccount(operation)
          : chat.manageMcp(operation),
      onMutate: (operation) => {
        setActiveServerId(
          "mcpServerId" in operation
            ? operation.mcpServerId
            : catalog.data?.connections.find((entry) => entry.id === operation.id)?.mcp_server_id,
        )
      },
      onSuccess: async () => {
        setHeadersFor(null)
        await catalog.refetch()
      },
    },
    client,
  )
  if (!identity) return null
  const busy = mutation.isPending
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
          render={
            <Button variant="ghost" size="icon-sm" aria-label="MCP servers" title="MCP servers" />
          }
        >
          <PlugIcon />
        </PopoverTrigger>
        <PopoverContent
          container={container}
          align="end"
          aria-labelledby={`${fieldId}-title`}
          className="max-h-[75vh] w-[min(24rem,85vw)] gap-0 overflow-hidden p-0"
        >
          <header className="shrink-0 space-y-1 border-b p-3">
            <h2 id={`${fieldId}-title`} className="font-semibold">
              MCP servers
            </h2>
          </header>
          <div className="min-h-0 divide-y overflow-y-auto">
            {catalog.isPending && (
              <p role="status" className="p-3 text-xs">
                Loading servers…
              </p>
            )}
            {catalog.isError && (
              <div className="p-3">
                <p role="alert" className="text-xs text-destructive">
                  {catalog.error.message}
                </p>
                <Button size="sm" onClick={() => void catalog.refetch()}>
                  Try again
                </Button>
              </div>
            )}
            {catalog.data?.servers.length === 0 && (
              <p className="p-3 text-xs text-muted-foreground">
                Your organization has not added any MCP servers yet.
              </p>
            )}
            {catalog.data?.servers.map((server) => {
              const account = catalog.data.connections.find(
                (entry) => entry.mcp_server_id === server.id,
              )
              const connected = account?.auth_state === "connected"
              const publicServer = server.auth_kind === "none"
              const active = activeServerId === server.id
              const StatusIcon = busy && active ? SpinnerGapIcon : PlugIcon
              const endpoint = new URL(server.endpoint_url)
              const disconnectLabel = publicServer
                ? "Disable"
                : account?.auth_state === "disconnected"
                  ? "Remove connection"
                  : "Disconnect"
              const labels = server.auth_kind
                ? {
                    none: ["Enable", "Enable"],
                    oauth: ["Connect account", "Reconnect"],
                    static_headers: ["Add credentials", "Replace credentials"],
                  }[server.auth_kind]
                : null
              return (
                <article key={server.id} data-slot="mcp-account" className="space-y-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <StatusIcon
                      aria-hidden="true"
                      className={`size-4 shrink-0 text-muted-foreground${busy && active ? " animate-spin" : ""}`}
                    />
                    <div className="min-w-0 flex-1" title={server.endpoint_url}>
                      <h3 className="truncate text-sm font-medium">{endpoint.hostname}</h3>
                      <p role="status" className="truncate text-xs text-muted-foreground">
                        {active && pendingLabel
                          ? pendingLabel
                          : active && mutation.isError && mutation.variables.action === "test"
                            ? "Connection failed"
                            : connected
                              ? publicServer
                                ? "Enabled"
                                : "Connected"
                              : account?.auth_state === "reauthorization_required"
                                ? "Reconnect needed"
                                : publicServer
                                  ? "Disabled"
                                  : "Not connected"}
                        {" · "}
                        {endpoint.pathname}
                        {endpoint.search}
                      </p>
                    </div>
                    {headersFor !== server.id && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        {labels && !(publicServer && connected) && (
                          <Button
                            size={connected ? "icon-sm" : "sm"}
                            variant={connected ? "ghost" : "outline"}
                            aria-label={`${labels[connected ? 1 : 0]}: ${endpoint.hostname}`}
                            title={labels[connected ? 1 : 0]}
                            disabled={busy}
                            onClick={() =>
                              server.auth_kind === "oauth"
                                ? mutation.mutate({
                                    action: "authorize",
                                    mcpServerId: server.id,
                                    ...(account ? { id: account.id } : {}),
                                  })
                                : server.auth_kind === "static_headers"
                                  ? setHeadersFor(server.id)
                                  : mutation.mutate({ action: "connect", mcpServerId: server.id })
                            }
                          >
                            {connected ? <ArrowClockwiseIcon /> : labels[0]}
                          </Button>
                        )}
                        {connected && account && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Test connection: ${endpoint.hostname}`}
                            title="Test connection"
                            disabled={busy}
                            onClick={() => mutation.mutate({ action: "test", id: account.id })}
                          >
                            <PulseIcon />
                          </Button>
                        )}
                        {account && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`${disconnectLabel}: ${endpoint.hostname}`}
                            title={disconnectLabel}
                            disabled={busy}
                            onClick={() =>
                              mutation.mutate({ action: "disconnect", id: account.id })
                            }
                          >
                            <XIcon />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {!server.auth_kind && (
                    <p className="text-xs text-destructive">
                      Configuration unavailable. Contact your administrator.
                    </p>
                  )}
                  {headersFor === server.id && (
                    <form
                      className="grid gap-2"
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
                          <div key={name} className="grid gap-1 text-xs">
                            <label htmlFor={`${fieldId}-${server.id}-${name}`}>{name} value</label>
                            <Input
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
                              <span
                                id={`${fieldId}-authorization-help`}
                                className="text-muted-foreground"
                              >
                                Enter the full value, including Bearer before the token when
                                required.
                              </span>
                            )}
                          </div>
                        ))}
                        <p className="text-xs text-muted-foreground">
                          Saved secrets are never shown. Enter every value to replace them.
                        </p>
                        <div className="flex gap-2">
                          <Button type="submit" size="sm">
                            Save credentials
                          </Button>
                          <Button
                            type="button"
                            size="sm"
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
                          ? "text-xs text-destructive"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {notice}
                    </p>
                  )}
                  {connected &&
                    account &&
                    state.unavailableMcpConnections?.includes(account.id) && (
                      <p className="text-xs text-muted-foreground">
                        Unavailable in the last chat. Test the connection or reconnect.
                      </p>
                    )}
                </article>
              )
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
