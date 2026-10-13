import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { McpServerSummary } from "@/lib/mcp/schemas"
export function McpClientForm({
  server,
  busy,
  save,
  callbackUri,
}: {
  callbackUri: string | null
  server: McpServerSummary
  busy: boolean
  save: (fields: {
    clientId: string
    clientSecret?: string
    tokenEndpointAuthMethod: "none" | "client_secret_post"
  }) => void
}) {
  return (
    <details className="w-full">
      <summary className="cursor-pointer text-sm">Configure OAuth application</summary>
      <form
        className="grid gap-3 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          const fields = new FormData(event.currentTarget)
          const secret = fields.get("secret") as string
          save({
            clientId: fields.get("clientId") as string,
            ...(secret ? { clientSecret: secret } : {}),
            tokenEndpointAuthMethod: secret ? "client_secret_post" : "none",
          })
          event.currentTarget.reset()
        }}
      >
        <fieldset disabled={busy || !callbackUri} className="grid gap-3">
          <p className="text-sm">
            Register the redirect URI below with{" "}
            {server.authConfig.kind === "oauth" && server.authConfig.profile === "google"
              ? "Google"
              : "your provider"}
            . Create another server to use a different application.
          </p>
          <Label htmlFor={`redirect-${server.id}`}>Redirect URI</Label>
          <Input
            id={`redirect-${server.id}`}
            value={callbackUri ?? "Configure the application URL first"}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
          <Label htmlFor={`client-${server.id}`}>Client ID</Label>
          <Input id={`client-${server.id}`} name="clientId" required />
          <Label htmlFor={`secret-${server.id}`}>Client secret</Label>
          <Input id={`secret-${server.id}`} type="password" name="secret" autoComplete="off" />
          <Button type="submit">{busy ? "Saving…" : "Save OAuth application"}</Button>
        </fieldset>
      </form>
    </details>
  )
}
