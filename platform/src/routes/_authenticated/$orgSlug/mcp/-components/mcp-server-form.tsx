import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type { McpAuthConfig, McpServerWriteSchema } from "@/lib/mcp/schemas"

export function McpServerForm({
  busy,
  callbackUri,
  save,
  cancel,
}: {
  busy: boolean
  callbackUri: string | null
  save: (fields: typeof McpServerWriteSchema.Type) => void
  cancel: () => void
}) {
  const [authentication, setAuthentication] = useState<McpAuthConfig["kind"]>("none")
  const [oauthSetup, setOauthSetup] = useState("automatic")
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        const authConfig: McpAuthConfig =
          authentication === "none"
            ? { kind: "none" }
            : authentication === "static_headers"
              ? {
                  kind: "static_headers",
                  headerNames: (fields.get("headers") as string)
                    .split(",")
                    .map((name) => name.trim())
                    .filter(Boolean),
                }
              : {
                  kind: "oauth",
                  ...(fields.get("applicationOrigin")
                    ? { applicationOrigin: fields.get("applicationOrigin") as string }
                    : {}),
                  profile: oauthSetup === "google" ? "google" : "standard",
                  requestedScopes: ((fields.get("scopes") as string | null) ?? "")
                    .split(/\s+/)
                    .filter(Boolean),
                  ...(oauthSetup !== "automatic"
                    ? {
                        client: {
                          clientId: fields.get("clientId") as string,
                          ...(fields.get("secret")
                            ? { clientSecret: fields.get("secret") as string }
                            : {}),
                          tokenEndpointAuthMethod: fields.get("method") as
                            | "none"
                            | "client_secret_basic"
                            | "client_secret_post",
                        },
                      }
                    : {}),
                }
        save({ endpointUrl: fields.get("endpoint") as string, authConfig })
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <Label htmlFor="mcp-endpoint">Public HTTPS endpoint</Label>
        <Input
          id="mcp-endpoint"
          type="url"
          name="endpoint"
          required
          placeholder="https://mcp.example.com/mcp"
        />
        <Label htmlFor="mcp-auth">Authentication</Label>
        <NativeSelect
          id="mcp-auth"
          value={authentication}
          onChange={(event) =>
            setAuthentication(event.currentTarget.value as McpAuthConfig["kind"])
          }
        >
          <option value="none">Public</option>
          <option value="static_headers">API key or static headers</option>
          <option value="oauth">OAuth</option>
        </NativeSelect>
        {authentication === "static_headers" && (
          <>
            <Label htmlFor="mcp-headers">Header names, comma separated</Label>
            <Input
              id="mcp-headers"
              name="headers"
              required
              placeholder="Authorization, X-Api-Key"
            />
            <p className="text-sm text-muted-foreground">
              Each person enters their own values when connecting.
            </p>
          </>
        )}
        {authentication === "oauth" && (
          <>
            <Label htmlFor="mcp-oauth-setup">OAuth setup</Label>
            <NativeSelect
              id="mcp-oauth-setup"
              value={oauthSetup}
              onChange={(event) => setOauthSetup(event.currentTarget.value)}
            >
              <option value="automatic">Automatic discovery</option>
              <option value="manual">Pre-registered application</option>
              <option value="google">Google</option>
            </NativeSelect>
            <Label htmlFor="mcp-application-origin">Application origin, optional</Label>
            <Input
              id="mcp-application-origin"
              name="applicationOrigin"
              type="url"
              placeholder="https://app.example.com"
            />
            <p className="text-sm text-muted-foreground">
              Allow OAuth from your embedded application&apos;s origin. The dashboard origin is
              always allowed.
            </p>
            <Label htmlFor="mcp-scopes">Requested scopes, optional</Label>
            <Input id="mcp-scopes" name="scopes" />
            {oauthSetup !== "automatic" && (
              <>
                <Label htmlFor="mcp-redirect">Redirect URI</Label>
                <Input
                  id="mcp-redirect"
                  value={callbackUri ?? "Configure the application URL first"}
                  readOnly
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Label htmlFor="mcp-client">Client ID</Label>
                <Input id="mcp-client" name="clientId" required />
                <Label htmlFor="mcp-secret">Client secret, if required</Label>
                <Input id="mcp-secret" name="secret" type="password" autoComplete="off" />
                <Label htmlFor="mcp-method">Token endpoint authentication</Label>
                <NativeSelect id="mcp-method" name="method" defaultValue="client_secret_post">
                  <option value="client_secret_post">Client secret in request body</option>
                  <option value="client_secret_basic">Client secret with HTTP Basic</option>
                  <option value="none">Public client, no secret</option>
                </NativeSelect>
              </>
            )}
          </>
        )}
        <p className="text-sm text-muted-foreground">
          Settings are fixed after creation. Remove and add the server again to change its endpoint
          or authentication.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit">{busy ? "Saving…" : "Add server"}</Button>
        </div>
      </fieldset>
    </form>
  )
}
