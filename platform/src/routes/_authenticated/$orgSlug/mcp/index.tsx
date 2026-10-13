import { useState } from "react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { PlusIcon } from "@phosphor-icons/react"
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
import type { McpServerSummary } from "@/lib/mcp/schemas"
import { getMcpDashboardData, mutateMcpDashboard } from "./-functions/mcp-dashboard"
import { McpServerForm } from "./-components/mcp-server-form"

export const Route = createFileRoute("/_authenticated/$orgSlug/mcp/")({
  beforeLoad: ({ context, params }) => {
    if (!context.organization.permissions.readConfiguration)
      throw redirect({ to: "/$orgSlug", params, replace: true })
  },
  loader: ({ params }) => getMcpDashboardData({ data: { organizationSlug: params.orgSlug } }),
  component: McpDashboardPage,
  head: () => ({ meta: [{ title: `Connections · ${APP_NAME}` }] }),
})
function McpDashboardPage() {
  const { orgSlug } = Route.useParams()
  const data = Route.useLoaderData()
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [removal, setRemoval] = useState<McpServerSummary | null>(null)
  const [error, setError] = useState("")
  const mutation = useMutation({
    mutationFn: (operation: Parameters<typeof mutateMcpDashboard>[0]["data"]["operation"]) =>
      mutateMcpDashboard({ data: { organizationSlug: orgSlug, operation } }),
    onMutate: () => setError(""),
    onSuccess: async (_result, operation) => {
      setAdding(false)
      setRemoval(null)
      await router.invalidate()
      toast.add({
        title: operation.action === "server" ? "Server added" : "Server removed",
        type: "success",
      })
    },
    onError: (failure) => setError(parseServerFnError(failure).message),
  })
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div>
        <h1 className="text-2xl font-semibold">Connections</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add integrations for your embedded agents. Each person connects their own account.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Available servers</h2>
        {data.permissions.updateConfiguration && (
          <Button
            onClick={() => {
              setError("")
              setAdding(true)
            }}
          >
            <PlusIcon />
            Add server
          </Button>
        )}
      </div>
      {data.servers.length === 0 && (
        <p className="border border-dashed p-6 text-sm text-muted-foreground">
          Add a public HTTPS MCP server to get started. People connect it from Connections in your
          embedded sidebar.
        </p>
      )}
      {data.servers.map((server) => (
        <article key={server.id} className="space-y-3 border p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="font-medium">{new URL(server.endpointUrl).hostname}</h3>
            <Badge variant="secondary">
              {server.authKind === "none"
                ? "Public"
                : server.authKind === "oauth"
                  ? "OAuth"
                  : server.authKind === "static_headers"
                    ? "API key / headers"
                    : "Configuration unavailable"}
            </Badge>
          </div>
          <p className="break-all text-sm text-muted-foreground">{server.endpointUrl}</p>
          {data.permissions.updateConfiguration && (
            <Button variant="outline" size="sm" onClick={() => setRemoval(server)}>
              Remove server
            </Button>
          )}
        </article>
      ))}
      <p className="text-sm text-muted-foreground">
        Credentials are private to each person. Connect and test an account in the application
        embedded sidebar.
      </p>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add server</DialogTitle>
            <DialogDescription>
              Configure the endpoint. Each person authorizes their own account.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <McpServerForm
            busy={mutation.isPending}
            callbackUri={data.callbackUri}
            save={(fields) => mutation.mutate({ action: "server", fields })}
            cancel={() => setAdding(false)}
          />
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={removal !== null}
        onOpenChange={(open) => {
          if (!open) setRemoval(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove server?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {removal?.endpointUrl} and its connections. People will need to connect
              again if you add it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={() => {
                if (removal) mutation.mutate({ action: "delete_server", id: removal.id })
              }}
            >
              Remove server
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
