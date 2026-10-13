import { PlugIcon, PlusIcon } from "@phosphor-icons/react"
import { QueryClient, useMutation, useQuery } from "@tanstack/react-query"
import { useCallback, useEffect, useId, useRef, useState } from "react"
import type { AstralBeamChatCore, AstralBeamChatState } from "../../core/session.ts"
import type { McpConnectionEncoded, McpServerEncoded } from "../../api/generated/api.ts"
import type { McpManagementOperation } from "../../core/mcp.ts"
import { Button } from "./ui/button.tsx"
import { Badge } from "./ui/badge.tsx"
import { Input } from "./ui/input.tsx"
import { NativeSelect } from "./ui/native-select.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx"
import { McpAccountEditor } from "./mcp-account-form.tsx"
import { McpServerEditor } from "./mcp-server-form.tsx"

type McpPanelEditor =
  | { kind: "account"; entry: McpConnectionEncoded | null }
  | { kind: "server"; entry: McpServerEncoded | null }
function mcpAccountStatus(entry: McpConnectionEncoded) {
  if (entry.availability === "policy_denied") return "Blocked by organization"
  if (entry.availability === "disabled" || !entry.enabled) return "Paused"
  if (entry.availability === "configuration_changed") return "Setup changed"
  return {
    connected: "Connected",
    disconnected: "Not connected",
    reauthorization_required: "Reconnect needed",
    refresh_uncertain: "Reconnect needed",
  }[entry.auth_state]
}
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
  const [shared, setShared] = useState(false)
  const [editor, setEditor] = useState<McpPanelEditor | null>(null)
  const [removal, setRemoval] = useState<{
    name: string
    operation: McpManagementOperation
  } | null>(null)
  const [notice, setNotice] = useState<{ message: string; error: boolean } | null>(null)
  const [connecting, setConnecting] = useState<string | null>(null)
  const previousView = useRef(false)
  const focusCancel = useCallback((element: HTMLButtonElement | null) => element?.focus(), [])
  useEffect(() => {
    const editing = editor !== null || removal !== null
    if (previousView.current && !editing)
      container.current?.querySelector<HTMLElement>('[data-slot="mcp-panel-title"]')?.focus()
    previousView.current = editing
  }, [editor, removal])
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
        await catalog.refetch()
        const message =
          operation.action === "test" && result && "tool_count" in result
            ? `${result.tool_count} tools available.`
            : {
                server: "Server saved. Add an account to connect it.",
                connection: "Account saved.",
                disconnect: "Account disconnected locally.",
                delete_connection: "Account deleted.",
                delete_server: "Server deleted.",
                test: "Connection checked.",
              }[operation.action]
        setNotice({ message, error: false })
      },
      onError: (error) => setNotice({ message: error.message, error: true }),
    },
    client,
  )
  if (!identity) return null
  const busy = mutation.isPending || connecting !== null
  const scope = shared ? "tenant" : "personal"
  const managed = (entry: McpConnectionEncoded | McpServerEncoded) =>
    entry.tenant_id === identity.tenant.id &&
    (entry.tenant_user_id === identity.user.id ||
      (entry.tenant_user_id === null && identity.user.admin))
  const servers = catalog.data?.servers ?? []
  const allowPersonalServer = catalog.data?.policy.allow_tenant_user_mcp_servers ?? false
  const allowSharedServer =
    identity.user.admin && (catalog.data?.policy.allow_tenant_mcp_servers ?? false)
  const personalServers = servers.filter(
    (entry) =>
      entry.enabled &&
      (entry.tenant_id === null
        ? entry.default_connection_scope === "tenant_user"
        : allowPersonalServer && entry.tenant_user_id === identity.user.id),
  )
  const sharedServers = servers.filter(
    (entry) =>
      entry.enabled &&
      (entry.tenant_id === null
        ? entry.default_connection_scope === "tenant"
        : allowSharedServer && entry.tenant_user_id === null),
  )
  const selectedServers = shared ? sharedServers : personalServers
  const editorServers =
    editor?.kind === "account" && editor.entry
      ? servers.filter(
          (entry) =>
            entry.id === editor.entry!.server_id &&
            entry.tenant_id === editor.entry!.server_tenant_id,
        )
      : selectedServers
  const openEditor = (next: McpPanelEditor, tenant: boolean) => {
    setNotice(null)
    setShared(tenant)
    setEditor(next)
  }
  const connect = async (entry: McpConnectionEncoded, form?: FormData) => {
    setNotice(null)
    setConnecting(entry.id)
    const clientId = form?.get("clientId") as string | undefined
    const secret = form?.get("secret") as string | undefined
    try {
      await chat.connectMcpAccount({
        id: entry.id,
        ...(entry.tenant_user_id === null ? { tenantId: identity.tenant.id } : {}),
        ...(clientId
          ? {
              manualClient: {
                client_id: clientId,
                ...(secret ? { client_secret: secret } : {}),
                token_endpoint_auth_method: secret ? "client_secret_post" : "none",
              },
            }
          : {}),
      })
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
  const remove = (entry: McpConnectionEncoded | McpServerEncoded, server: boolean) => {
    setNotice(null)
    setRemoval({
      name: entry.name,
      operation: {
        scope: entry.tenant_user_id === null ? "tenant" : "personal",
        tenantId: identity.tenant.id,
        action: server ? "delete_server" : "delete_connection",
        id: entry.id,
        lockVersion: entry.lock_version,
      },
    })
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
          aria-labelledby={`${fieldId}-title`}
          container={container}
          align="end"
          className="max-h-[75vh] w-[min(24rem,85vw)] space-y-4 overflow-y-auto p-4"
        >
          <h2
            id={`${fieldId}-title`}
            data-slot="mcp-panel-title"
            tabIndex={-1}
            className="font-semibold"
          >
            Connections
          </h2>
          <p className="text-xs text-muted-foreground">
            Tools use the account you connect. Their results are saved in this conversation and
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
          {removal ? (
            <div
              className="space-y-3 border p-3"
              role="group"
              aria-labelledby={`${fieldId}-delete`}
            >
              <h3 id={`${fieldId}-delete`} className="font-medium">
                Delete {removal.name}?
              </h3>
              <p className="text-xs text-muted-foreground">
                {removal.operation.action === "delete_server"
                  ? "This removes the server and all its accounts. Its tools will stop being available."
                  : "This removes this account and its stored credentials. Provider access is not revoked."}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    mutation.mutate(removal.operation, { onSuccess: () => setRemoval(null) })
                  }
                >
                  {mutation.isPending
                    ? "Deleting…"
                    : removal.operation.action === "delete_server"
                      ? "Delete server"
                      : "Delete account"}
                </Button>
                <Button
                  ref={focusCancel}
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRemoval(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : editor ? (
            <div className="space-y-3">
              {identity.user.admin && !editor.entry && (
                <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-scope`}>
                  {editor.kind === "account"
                    ? "Who can use this account"
                    : "Who can use this server"}
                  <NativeSelect
                    className="w-full"
                    id={`${fieldId}-scope`}
                    value={shared ? "tenant" : "personal"}
                    disabled={busy}
                    onChange={(event) => setShared(event.currentTarget.value === "tenant")}
                  >
                    <option
                      value="personal"
                      disabled={editor.kind === "server" && !allowPersonalServer}
                    >
                      Only me
                    </option>
                    <option
                      value="tenant"
                      disabled={editor.kind === "server" && !allowSharedServer}
                    >
                      Everyone in this Tenant
                    </option>
                  </NativeSelect>
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                {editor.kind === "server"
                  ? shared
                    ? "Tenant administrators connect a shared account for this server."
                    : "Only you can connect accounts for this server."
                  : shared
                    ? "Everyone in this Tenant can use the connected account’s tools."
                    : "This account is available only to you. Results follow the conversation’s visibility."}
              </p>
              {editor.kind === "account" ? (
                <McpAccountEditor
                  key={`${editor.entry?.id ?? "new"}:${scope}`}
                  account={editor.entry}
                  servers={editorServers}
                  busy={busy}
                  cancel={() => setEditor(null)}
                  save={(fields) =>
                    mutation.mutate(
                      {
                        scope,
                        tenantId: identity.tenant.id,
                        action: "connection",
                        ...(editor.entry ? { id: editor.entry.id } : {}),
                        fields,
                      },
                      { onSuccess: () => setEditor(null) },
                    )
                  }
                />
              ) : (
                <McpServerEditor
                  key={`${editor.entry?.id ?? "new"}:${scope}`}
                  server={editor.entry}
                  shared={shared}
                  busy={busy}
                  cancel={() => setEditor(null)}
                  save={(fields) =>
                    mutation.mutate(
                      {
                        scope,
                        tenantId: identity.tenant.id,
                        action: "server",
                        ...(editor.entry ? { id: editor.entry.id } : {}),
                        fields,
                      },
                      { onSuccess: () => setEditor(null) },
                    )
                  }
                />
              )}
            </div>
          ) : (
            catalog.data && (
              <>
                {catalog.data.connections.length === 0 && (
                  <p className="border border-dashed p-3 text-xs text-muted-foreground">
                    No accounts yet. Add an account to connect an available integration.
                  </p>
                )}
                {catalog.data.connections.map((entry) => {
                  const server = servers.find(
                    (candidate) =>
                      candidate.id === entry.server_id &&
                      candidate.tenant_id === entry.server_tenant_id,
                  )
                  const blocked =
                    entry.availability === "policy_denied" || entry.availability === "disabled"
                  return (
                    <article
                      key={`${entry.tenant_id}:${entry.id}`}
                      data-slot="mcp-account"
                      className="space-y-2 border p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="min-w-0 break-words font-medium">{entry.name}</h3>
                        <Badge
                          variant={
                            entry.auth_state === "connected" && entry.availability === "available"
                              ? "secondary"
                              : "outline"
                          }
                        >
                          {mcpAccountStatus(entry)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {server?.name} ·{" "}
                        {entry.tenant_user_id
                          ? "Personal"
                          : entry.tenant_id
                            ? "Tenant shared"
                            : "Organization shared"}
                      </p>
                      {entry.availability === "policy_denied" && (
                        <p className="text-xs text-muted-foreground">
                          Your organization has disabled this type of custom server. Contact an
                          administrator to restore access.
                        </p>
                      )}
                      {entry.availability === "configuration_changed" && (
                        <p className="text-xs text-muted-foreground">
                          The server settings changed.{" "}
                          {server?.auth_config.kind === "oauth"
                            ? "Reconnect to restore access."
                            : server?.auth_config.kind === "none"
                              ? "Edit and save this account to use the updated server."
                              : "Edit this account and update its credentials."}
                        </p>
                      )}
                      {entry.auth_state === "refresh_uncertain" && (
                        <p className="text-xs text-muted-foreground">
                          Access could not be renewed safely. Reconnect this account.
                        </p>
                      )}
                      {!managed(entry) && (
                        <p className="text-xs text-muted-foreground">
                          Managed by{" "}
                          {entry.tenant_id ? "a Tenant administrator" : "your organization"}.
                        </p>
                      )}
                      {managed(entry) && (
                        <div className="flex flex-wrap gap-2">
                          {server?.auth_config.kind === "oauth" && (
                            <Button
                              size="sm"
                              disabled={busy || blocked}
                              onClick={() => void connect(entry)}
                            >
                              {connecting === entry.id
                                ? "Waiting for authorization…"
                                : entry.auth_state === "disconnected"
                                  ? "Connect account"
                                  : "Reconnect account"}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || entry.availability === "policy_denied"}
                            onClick={() =>
                              openEditor({ kind: "account", entry }, entry.tenant_user_id === null)
                            }
                          >
                            Edit account
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={
                              busy ||
                              entry.auth_state !== "connected" ||
                              entry.availability !== "available"
                            }
                            onClick={() =>
                              mutation.mutate({
                                scope: entry.tenant_user_id === null ? "tenant" : "personal",
                                tenantId: identity.tenant.id,
                                action: "test",
                                id: entry.id,
                              })
                            }
                          >
                            Test connection
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy || entry.auth_state === "disconnected"}
                            onClick={() =>
                              mutation.mutate({
                                scope: entry.tenant_user_id === null ? "tenant" : "personal",
                                tenantId: identity.tenant.id,
                                action: "disconnect",
                                id: entry.id,
                              })
                            }
                          >
                            Disconnect locally
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => remove(entry, false)}
                          >
                            Delete account
                          </Button>
                        </div>
                      )}
                      {managed(entry) && server?.auth_config.kind === "oauth" && (
                        <details>
                          <summary className="cursor-pointer text-xs">
                            Use your own OAuth application
                          </summary>
                          <form
                            className="grid gap-2 py-2"
                            onSubmit={(event) => {
                              event.preventDefault()
                              const element = event.currentTarget
                              const fields = new FormData(element)
                              void connect(entry, fields)
                              element.reset()
                            }}
                          >
                            <fieldset disabled={busy || blocked} className="grid gap-2">
                              <p className="text-xs text-muted-foreground">
                                Use the application provided by your organization, or register your
                                own with the redirect URI below.
                              </p>
                              {catalog.data?.callback_uri && (
                                <label
                                  className="grid gap-1 text-xs"
                                  htmlFor={`${fieldId}-${entry.id}-redirect`}
                                >
                                  Redirect URI
                                  <Input
                                    id={`${fieldId}-${entry.id}-redirect`}
                                    value={catalog.data.callback_uri}
                                    readOnly
                                    onFocus={(event) => event.currentTarget.select()}
                                  />
                                </label>
                              )}
                              <label
                                className="grid gap-1 text-xs"
                                htmlFor={`${fieldId}-${entry.id}-client`}
                              >
                                Client ID
                                <Input
                                  id={`${fieldId}-${entry.id}-client`}
                                  name="clientId"
                                  required
                                />
                              </label>
                              <label
                                className="grid gap-1 text-xs"
                                htmlFor={`${fieldId}-${entry.id}-secret`}
                              >
                                Client secret
                                <Input
                                  id={`${fieldId}-${entry.id}-secret`}
                                  name="secret"
                                  type="password"
                                  autoComplete="off"
                                />
                              </label>
                              <Button type="submit" size="sm">
                                Connect with this application
                              </Button>
                            </fieldset>
                          </form>
                        </details>
                      )}
                    </article>
                  )
                })}
                <Button
                  size="sm"
                  disabled={
                    busy ||
                    (!personalServers.length && !(identity.user.admin && sharedServers.length))
                  }
                  onClick={() =>
                    openEditor(
                      { kind: "account", entry: null },
                      !personalServers.length && identity.user.admin,
                    )
                  }
                >
                  <PlusIcon aria-hidden="true" />
                  Add account
                </Button>
                {!personalServers.length && !sharedServers.length && (
                  <p className="text-xs text-muted-foreground">
                    Your organization has not provided integrations to connect yet.
                    {allowPersonalServer || allowSharedServer
                      ? " You can add a custom server below."
                      : " Contact an administrator to add one."}
                  </p>
                )}
                <details className="border-t pt-3">
                  <summary className="cursor-pointer text-xs font-medium">Custom servers</summary>
                  <div className="mt-3 space-y-3">
                    {servers
                      .filter((entry) => entry.tenant_id !== null && managed(entry))
                      .map((entry) => (
                        <div className="space-y-2 border p-3" key={entry.id}>
                          <p className="break-words text-xs font-medium">{entry.name}</p>
                          <p className="break-all text-xs text-muted-foreground">
                            {entry.endpoint_url}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                busy ||
                                (entry.tenant_user_id ? !allowPersonalServer : !allowSharedServer)
                              }
                              onClick={() =>
                                openEditor({ kind: "server", entry }, entry.tenant_user_id === null)
                              }
                            >
                              Edit server
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => remove(entry, true)}
                            >
                              Delete server
                            </Button>
                          </div>
                        </div>
                      ))}
                    {allowPersonalServer || allowSharedServer ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          openEditor({ kind: "server", entry: null }, !allowPersonalServer)
                        }
                      >
                        Add custom server
                      </Button>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Custom servers are disabled by your organization. Organization defaults
                        remain available.
                      </p>
                    )}
                  </div>
                </details>
                <p className="text-xs text-muted-foreground">
                  Disconnect clears stored credentials locally. Manage provider access separately,
                  including{" "}
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
              </>
            )
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
