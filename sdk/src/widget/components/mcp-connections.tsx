import { PlugIcon } from "@phosphor-icons/react"
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { useId, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
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
  const [removal, setRemoval] = useState<string | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)
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
      mutationFn: chat.manageMcp,
      onMutate: () => setNotice(null),
      onSuccess: async (result, operation) => {
        setHeadersFor(null)
        setRemoval(null)
        await catalog.refetch()
        setNotice({
          message:
            operation.action === "test" && result && "tool_count" in result
              ? `${result.tool_count} tools available.`
              : operation.action === "disconnect"
                ? "Account disconnected locally."
                : operation.action === "delete_connection"
                  ? "Connection removed."
                  : "Account connected.",
          error: false,
        })
      },
      onError: (error) => setNotice({ message: error.message, error: true }),
    },
    client,
  )
  if (!identity) return null
  const busy = mutation.isPending || connecting !== null
  const connect = async (serverId: string, id?: string) => {
    setNotice(null)
    setConnecting(serverId)
    try {
      await chat.connectMcpAccount({ serverId, ...(id ? { id } : {}) })
      await catalog.refetch()
      setNotice({ message: "Account connected.", error: false })
    } catch (error) {
      setNotice({
        message: error instanceof Error ? error.message : "Unable to connect account.",
        error: true,
      })
    } finally {
      setConnecting(null)
    }
  }
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
          className="max-h-[75vh] w-[min(24rem,85vw)] space-y-4 overflow-y-auto p-4"
        >
          <h2 id={`${fieldId}-title`} className="font-semibold">
            Connections
          </h2>
          <p className="text-xs text-muted-foreground">
            Only you can use your connected accounts. Tool results are saved in the conversation and
            visible to everyone who can read it.
          </p>
          {notice && (
            <p
              data-slot="mcp-notice"
              role={notice.error ? "alert" : "status"}
              className={notice.error ? "text-xs text-destructive" : "text-xs"}
            >
              {notice.message}
            </p>
          )}
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
            const account = catalog.data.connections.find((entry) => entry.server_id === server.id)
            const connected = account?.auth_state === "connected"
            return (
              <article key={server.id} data-slot="mcp-account" className="space-y-2 border p-3">
                <h3 className="break-words font-medium">{new URL(server.endpoint_url).hostname}</h3>
                <p className="break-all text-xs text-muted-foreground">{server.endpoint_url}</p>
                <p className="text-xs">
                  {connected
                    ? "Connected"
                    : account?.auth_state === "reauthorization_required"
                      ? "Reconnect needed"
                      : "Not connected"}
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
                        serverId: server.id,
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
                        Enter every value to replace credentials. Saved secrets are never shown.
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
                    {server.auth_kind && (
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          server.auth_kind === "oauth"
                            ? void connect(server.id, account?.id)
                            : server.auth_kind === "static_headers"
                              ? setHeadersFor(server.id)
                              : mutation.mutate({ action: "connect", serverId: server.id })
                        }
                      >
                        {connecting === server.id
                          ? "Waiting for authorization…"
                          : connected
                            ? "Reconnect account"
                            : "Connect account"}
                      </Button>
                    )}
                    {account && connected && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "test", id: account.id })}
                        >
                          Test connection
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => mutation.mutate({ action: "disconnect", id: account.id })}
                        >
                          Disconnect locally
                        </Button>
                      </>
                    )}
                    {account && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRemoval(account.id)}
                      >
                        Remove connection
                      </Button>
                    )}
                  </div>
                )}
                {account && removal === account.id && (
                  <div className="space-y-2">
                    <p className="text-xs">Remove this connection and its stored credentials?</p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                          mutation.mutate({ action: "delete_connection", id: account.id })
                        }
                      >
                        Confirm removal
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRemoval(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
          <p className="text-xs text-muted-foreground">
            Disconnect clears credentials locally. Provider access is managed separately, including{" "}
            <a
              href="https://myaccount.google.com/permissions"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Google access
            </a>
            .
          </p>
        </PopoverContent>
      </Popover>
    </div>
  )
}
