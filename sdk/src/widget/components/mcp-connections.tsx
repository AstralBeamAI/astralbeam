import { PlugIcon, XIcon } from "@phosphor-icons/react"
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { McpManagementOperation } from "../../core/mcp.ts"
import { Button } from "./ui/button.tsx"
import { Badge } from "./ui/badge.tsx"
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
  const notice = mutation.isError
    ? mutation.error.message
    : busy
      ? mutation.variables.action === "authorize"
        ? "Waiting for sign-in…"
        : "Updating connection…"
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
            <Button variant="ghost" size="icon-sm" aria-label="Connections" title="Connections" />
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
          <header className="shrink-0 space-y-1 border-b p-4">
            <h2 id={`${fieldId}-title`} className="font-semibold">
              Connections
            </h2>
            <p className="text-xs text-muted-foreground">
              Only you can use your connections. Tool results are saved and visible to everyone with
              conversation access.
            </p>
          </header>
          <div className="min-h-0 space-y-3 overflow-y-auto p-3">
            {catalog.isPending && <p role="status">Loading connections…</p>}
            {catalog.isError && (
              <div>
                <p role="alert" className="text-xs text-destructive">
                  {catalog.error.message}
                </p>
                <Button size="sm" onClick={() => void catalog.refetch()}>
                  Try again
                </Button>
              </div>
            )}
            {catalog.data?.servers.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Your organization has not added any integrations yet.
              </p>
            )}
            {catalog.data?.servers.map((server) => {
              const account = catalog.data.connections.find(
                (entry) => entry.mcp_server_id === server.id,
              )
              const connected = account?.auth_state === "connected"
              const publicServer = server.auth_kind === "none"
              const active = activeServerId === server.id
              const endpoint = new URL(server.endpoint_url)
              const labels = server.auth_kind
                ? {
                    none: ["No sign-in required", "Enable", "Enable"],
                    oauth: ["Account sign-in", "Connect account", "Reconnect"],
                    static_headers: ["API credentials", "Add credentials", "Replace credentials"],
                  }[server.auth_kind]
                : null
              return (
                <article
                  key={server.id}
                  data-slot="mcp-account"
                  aria-busy={busy && active}
                  className="space-y-2 rounded-lg border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 break-words font-medium" title={server.endpoint_url}>
                      {endpoint.hostname}
                    </h3>
                    <Badge variant={connected ? "secondary" : "outline"}>
                      {connected
                        ? publicServer
                          ? "Enabled"
                          : "Connected"
                        : account?.auth_state === "reauthorization_required"
                          ? "Reconnect needed"
                          : publicServer
                            ? "Disabled"
                            : "Not connected"}
                    </Badge>
                  </div>
                  <p className="truncate text-xs text-muted-foreground" title={server.endpoint_url}>
                    {labels?.[0] ?? "Configuration unavailable"}
                    {" · "}
                    {endpoint.pathname}
                  </p>
                  {!server.auth_kind && (
                    <p className="text-xs text-destructive">
                      Configuration unavailable. Contact your administrator.
                    </p>
                  )}
                  {headersFor === server.id ? (
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
                          <label
                            key={name}
                            className="grid gap-1 text-xs"
                            htmlFor={`${fieldId}-${server.id}-${name}`}
                          >
                            {name} value
                            <Input
                              id={`${fieldId}-${server.id}-${name}`}
                              name={name}
                              type="password"
                              autoComplete="off"
                              required
                            />
                          </label>
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
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {connected && account && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "test", id: account.id })}
                        >
                          Check tools
                        </Button>
                      )}
                      {labels && !(publicServer && connected) && (
                        <Button
                          size="sm"
                          variant={connected ? "ghost" : "default"}
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
                          {labels[connected ? 2 : 1]}
                        </Button>
                      )}
                      {account && (
                        <Button
                          size={publicServer ? "sm" : "icon-sm"}
                          variant="ghost"
                          aria-label={publicServer ? "Disable" : "Disconnect locally"}
                          title={publicServer ? "Disable" : "Disconnect locally"}
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "disconnect", id: account.id })}
                        >
                          {publicServer ? "Disable" : <XIcon />}
                        </Button>
                      )}
                    </div>
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
                    state.unavailableMcpConnections?.includes(account.id) &&
                    !(active && mutation.isSuccess && mutation.variables.action === "test") && (
                      <p className="text-xs text-muted-foreground">
                        Unavailable in the last chat. Check tools or reconnect.
                      </p>
                    )}
                </article>
              )
            })}
          </div>
          <p className="shrink-0 border-t p-3 text-xs text-muted-foreground">
            Disconnect removes credentials from AstralBeam. Manage provider access in the connected
            app.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
