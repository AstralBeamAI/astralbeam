import { useState } from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { PlusIcon } from "@phosphor-icons/react"
import { runMcpAuthorization } from "@astralbeam/sdk/core"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/toast"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { APP_NAME } from "@/lib/constants"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import type { McpServerSummary, McpConnectionSummary } from "@/lib/mcp/schemas"
import { getMcpDashboardData, mutateMcpDashboard } from "./-functions/mcp-dashboard"
import { McpServerForm } from "./-components/mcp-server-form"
import { McpAccountForm } from "./-components/mcp-account-form"
import { McpClientForm } from "./-components/mcp-client-form"
import { McpPolicyForm } from "./-components/mcp-policy-form"

export const Route = createFileRoute("/_authenticated/$orgSlug/mcp/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration)
      throw redirect({ to: "/$orgSlug", params, replace: true })
  },
  loader: ({ params }) => getMcpDashboardData({ data: { organizationSlug: params.orgSlug } }),
  component: McpDashboardPage,
  head: () => ({ meta: [{ title: `Connections · ${APP_NAME}` }] }),
})
type McpDashboardOperation = Parameters<typeof mutateMcpDashboard>[0]["data"]["operation"]
type McpDashboardEditor =
  | { kind: "server"; entry: McpServerSummary | null }
  | { kind: "account"; entry: McpConnectionSummary | null }
function McpDashboardPage() {
  const { orgSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const router = useRouter()
  const [editor, setEditor] = useState<McpDashboardEditor | null>(null)
  const [removal, setRemoval] = useState<{ name: string; operation: McpDashboardOperation } | null>(
    null,
  )
  const [error, setError] = useState("")
  const [connecting, setConnecting] = useState<string | null>(null)
  const submitMcpDashboard = (operation: McpDashboardOperation) =>
    mutateMcpDashboard({ data: { organizationSlug: orgSlug, operation } }).catch((failure) => {
      throw new Error(parseServerFnError(failure).message)
    })
  const mutation = useMutation({
    mutationFn: submitMcpDashboard,
    onMutate: () => setError(""),
    onSuccess: async (result, operation) => {
      await router.invalidate()
      const title =
        operation.action === "test" && result && "toolCount" in result
          ? `${result.toolCount} tools available`
          : {
              server: "Server saved",
              connection: "Account saved",
              policy: "Permissions saved",
              client: "OAuth application saved",
              disconnect: "Account disconnected",
              delete_server: "Server deleted",
              delete_connection: "Account deleted",
              authorize: "Authorization started",
              bind: "Browser verified",
              complete: "Account connected",
              test: "Connection checked",
            }[operation.action]
      toast.add({ title, type: "success" })
    },
    onError: (failure) => setError(failure.message),
  })
  const busy = mutation.isPending || connecting !== null
  const sharedServers = data.servers.filter(
    (entry) => entry.defaultConnectionScope === "organization",
  )
  const reference = (entry: McpServerSummary | McpConnectionSummary) => ({
    organizationId: entry.organizationId,
    tenantId: null,
    id: entry.id,
  })
  const openEditor = (next: McpDashboardEditor) => {
    setError("")
    setEditor(next)
  }
  const authorize = async (entry: McpConnectionSummary) => {
    setError("")
    setConnecting(entry.id)
    try {
      await runMcpAuthorization({
        start: async () => {
          const result = await submitMcpDashboard({
            action: "authorize",
            reference: reference(entry),
          })
          if (!result || !("popupUrl" in result)) throw new Error("Authorization unavailable.")
          return result
        },
        bind: async (attempt, challenge) => {
          await submitMcpDashboard({ action: "bind", reference: attempt, challenge })
        },
        complete: async (attempt) => {
          await submitMcpDashboard({ action: "complete", reference: attempt })
        },
      })
      await router.invalidate()
      toast.add({ title: "Account connected", type: "success" })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Authorization failed.")
    } finally {
      setConnecting(null)
    }
  }
  return (
    <div className="flex flex-1 flex-col gap-8 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the integrations your agents can use and who connects each account.
        </p>
      </div>
      {error && !editor && !removal && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <section className="grid max-w-4xl gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Default servers</h2>
            <p className="text-sm text-muted-foreground">
              Available to your Tenants, even when custom servers are disabled.
            </p>
          </div>
          {data.permissions.updateConfiguration && (
            <Button onClick={() => openEditor({ kind: "server", entry: null })} disabled={busy}>
              <PlusIcon aria-hidden="true" />
              Add server
            </Button>
          )}
        </div>
        {!data.servers.length && (
          <p className="border border-dashed p-6 text-sm text-muted-foreground">
            No servers yet. Add a public endpoint, an API key integration, or an OAuth provider.
          </p>
        )}
        {data.servers.map((entry) => (
          <article className="space-y-3 border p-4" key={entry.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-medium">{entry.name}</h3>
                <p className="break-all text-xs text-muted-foreground">{entry.endpointUrl}</p>
              </div>
              <Badge variant="secondary">{entry.enabled ? "Available" : "Paused"}</Badge>
            </div>
            <p className="text-sm">
              {
                {
                  organization: "Organization shares one account",
                  tenant: "Each Tenant connects an account",
                  tenant_user: "Each person connects their own account",
                }[entry.defaultConnectionScope]
              }{" "}
              ·{" "}
              {
                { none: "Public", static_headers: "API key / headers", oauth: "OAuth" }[
                  entry.authConfig.kind
                ]
              }
            </p>
            {data.permissions.updateConfiguration && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => openEditor({ kind: "server", entry })}
                >
                  Edit server
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setError("")
                    setRemoval({
                      name: entry.name,
                      operation: {
                        action: "delete_server",
                        reference: reference(entry),
                        lockVersion: entry.lockVersion,
                      },
                    })
                  }}
                >
                  Delete server
                </Button>
                {entry.authConfig.kind === "oauth" && (
                  <McpClientForm
                    callbackUri={data.callbackUri}
                    server={entry}
                    busy={busy}
                    save={(fields) =>
                      mutation.mutate({ action: "client", reference: reference(entry), fields })
                    }
                  />
                )}
              </div>
            )}
          </article>
        ))}
      </section>
      <section className="grid max-w-4xl gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Organization accounts</h2>
            <p className="text-sm text-muted-foreground">
              Shared with every Tenant. Personal integrations are connected by each person.
            </p>
          </div>
          {data.permissions.updateConfiguration && (
            <Button
              disabled={busy || !sharedServers.length}
              onClick={() => openEditor({ kind: "account", entry: null })}
            >
              <PlusIcon aria-hidden="true" />
              Add shared account
            </Button>
          )}
        </div>
        {!data.connections.length && (
          <p className="border border-dashed p-6 text-sm text-muted-foreground">
            {sharedServers.length
              ? "Add a shared account to make this server’s tools available to your Tenants."
              : "To share credentials, add a server with an Organization shared account. Tenant and personal accounts are connected in the embedded assistant."}
          </p>
        )}
        {data.connections.map((entry) => {
          const server = data.servers.find((item) => item.id === entry.serverId)
          const reconnect =
            entry.authState === "reauthorization_required" ||
            entry.authState === "refresh_uncertain" ||
            entry.availability === "configuration_changed"
          return (
            <article className="space-y-3 border p-4" key={entry.id}>
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <h3 className="font-medium">{entry.name}</h3>
                  <p className="text-xs text-muted-foreground">{server?.name}</p>
                </div>
                <Badge variant={reconnect ? "destructive" : "secondary"}>
                  {!entry.enabled || !server?.enabled
                    ? "Paused"
                    : reconnect
                      ? "Reconnect needed"
                      : entry.authState === "connected"
                        ? "Connected"
                        : "Not connected"}
                </Badge>
              </div>
              {reconnect && (
                <p className="text-sm text-muted-foreground">
                  {server?.authConfig.kind === "oauth"
                    ? "Reconnect this account to restore access."
                    : server?.authConfig.kind === "none"
                      ? "Edit and save this account to use the updated server."
                      : "Edit this account and enter its credentials again to restore access."}
                </p>
              )}
              {entry.verificationResult === "unavailable" && (
                <p className="text-sm text-muted-foreground">
                  The last connection check failed. Check the server settings and try again.
                </p>
              )}
              {data.permissions.updateConfiguration && (
                <div className="flex flex-wrap gap-2">
                  {server?.authConfig.kind === "oauth" && (
                    <Button
                      disabled={busy || !server.enabled}
                      onClick={() => void authorize(entry)}
                    >
                      {connecting === entry.id
                        ? "Waiting for authorization…"
                        : entry.authState === "disconnected"
                          ? "Connect account"
                          : "Reconnect account"}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => openEditor({ kind: "account", entry })}
                  >
                    Edit account
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      busy || entry.authState !== "connected" || entry.availability !== "available"
                    }
                    onClick={() => mutation.mutate({ action: "test", reference: reference(entry) })}
                  >
                    Test connection
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy || entry.authState === "disconnected"}
                    onClick={() =>
                      mutation.mutate({ action: "disconnect", reference: reference(entry) })
                    }
                  >
                    Disconnect locally
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError("")
                      setRemoval({
                        name: entry.name,
                        operation: {
                          action: "delete_connection",
                          reference: reference(entry),
                          lockVersion: entry.lockVersion,
                        },
                      })
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              )}
            </article>
          )
        })}
      </section>
      {data.permissions.updateConfiguration && (
        <details className="max-w-4xl border p-4">
          <summary className="cursor-pointer font-semibold">Custom server permissions</summary>
          <McpPolicyForm
            key={data.policy.lockVersion}
            policy={data.policy}
            busy={busy}
            save={(policy) => mutation.mutate({ action: "policy", policy })}
          />
        </details>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setEditor(null)
            setError("")
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {editor?.kind === "server"
                ? editor.entry
                  ? "Edit server"
                  : "Add server"
                : editor?.entry
                  ? "Edit shared account"
                  : "Add shared account"}
            </DialogTitle>
            <DialogDescription>
              {editor?.kind === "server"
                ? "Configure an integration and choose who connects their account."
                : "These credentials will be shared with every Tenant in your Organization."}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {editor?.kind === "server" && (
            <McpServerForm
              server={editor.entry}
              busy={busy}
              cancel={() => setEditor(null)}
              save={(fields) =>
                mutation.mutate(
                  { action: "server", id: editor.entry?.id ?? null, fields },
                  { onSuccess: () => setEditor(null) },
                )
              }
            />
          )}
          {editor?.kind === "account" && (
            <McpAccountForm
              connection={editor.entry}
              servers={sharedServers}
              busy={busy}
              cancel={() => setEditor(null)}
              save={(fields) =>
                mutation.mutate(
                  { action: "connection", id: editor.entry?.id ?? null, fields },
                  { onSuccess: () => setEditor(null) },
                )
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {removal?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removal?.operation.action === "delete_server"
                ? "This removes the server and all its accounts, including Tenant and personal accounts. Its tools will stop being available to agents."
                : "This removes this account and its stored credentials. It does not revoke access at the provider."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              variant="destructive"
              onClick={() => {
                if (removal)
                  mutation.mutate(removal.operation, { onSuccess: () => setRemoval(null) })
              }}
            >
              {mutation.isPending
                ? "Deleting…"
                : removal?.operation.action === "delete_server"
                  ? "Delete server"
                  : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
