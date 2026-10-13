import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type { McpAuthConfig, McpServerSummary, McpServerWriteSchema } from "@/lib/mcp/schemas"
export function McpServerForm({
  server,
  busy,
  save,
  cancel,
}: {
  server: McpServerSummary | null
  busy: boolean
  save: (fields: typeof McpServerWriteSchema.Type) => void
  cancel: () => void
}) {
  const [authentication, setAuthentication] = useState(server?.authConfig.kind ?? "none")
  const [profile, setProfile] = useState(
    server?.authConfig.kind === "oauth" ? server.authConfig.profile : "standard",
  )
  const [registration, setRegistration] = useState(
    server?.authConfig.kind === "oauth" ? server.authConfig.registration : "automatic",
  )
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        const kind = fields.get("auth") as string
        const authConfig: McpAuthConfig =
          kind === "none"
            ? { kind }
            : kind === "static_headers"
              ? {
                  kind,
                  headerNames: (fields.get("headers") as string)
                    .split(",")
                    .map((value) => value.trim())
                    .filter(Boolean),
                }
              : {
                  kind: "oauth",
                  registration:
                    fields.get("registration") === "pre_registered"
                      ? "pre_registered"
                      : "automatic",
                  profile: fields.get("profile") === "google" ? "google" : "standard",
                  requestedScopes: (fields.get("scopes") as string).split(/\s+/).filter(Boolean),
                }
        save({
          name: fields.get("name") as string,
          endpointUrl: fields.get("endpoint") as string,
          defaultConnectionScope: fields.get("scope") as McpServerSummary["defaultConnectionScope"],
          authConfig,
          enabled: fields.has("enabled"),
          ...(server ? { lockVersion: server.lockVersion } : {}),
        })
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <Label htmlFor="mcp-name">Name</Label>
        <Input id="mcp-name" name="name" required defaultValue={server?.name} />
        <Label htmlFor="mcp-endpoint">Public HTTPS endpoint</Label>
        <Input
          id="mcp-endpoint"
          type="url"
          name="endpoint"
          required
          defaultValue={server?.endpointUrl}
        />
        <Label htmlFor="mcp-scope">Who connects</Label>
        <NativeSelect
          className="w-full"
          id="mcp-scope"
          name="scope"
          defaultValue={server?.defaultConnectionScope ?? "organization"}
        >
          <option value="organization">Organization shared account</option>
          <option value="tenant">Each Tenant connects an account</option>
          <option value="tenant_user">Each person connects their own account</option>
        </NativeSelect>
        <Label htmlFor="mcp-auth">Authentication</Label>
        <NativeSelect
          className="w-full"
          id="mcp-auth"
          name="auth"
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
            <Label htmlFor="mcp-headers">Static header names, comma separated</Label>
            <Input
              id="mcp-headers"
              name="headers"
              required
              placeholder="Authorization, X-Api-Key"
              defaultValue={
                server?.authConfig.kind === "static_headers"
                  ? server.authConfig.headerNames.join(", ")
                  : ""
              }
            />
          </>
        )}
        {authentication === "oauth" && (
          <>
            <Label htmlFor="mcp-registration">OAuth registration</Label>
            <NativeSelect
              className="w-full"
              id="mcp-registration"
              name="registration"
              value={registration}
              onChange={(event) =>
                setRegistration(event.currentTarget.value as "automatic" | "pre_registered")
              }
            >
              <option value="automatic" disabled={profile === "google"}>
                Automatic registration
              </option>
              <option value="pre_registered">Pre-registered application</option>
            </NativeSelect>
            <Label htmlFor="mcp-profile">OAuth provider</Label>
            <NativeSelect
              className="w-full"
              id="mcp-profile"
              name="profile"
              value={profile}
              onChange={(event) => {
                setProfile(event.currentTarget.value as "standard" | "google")
                if (event.currentTarget.value === "google") setRegistration("pre_registered")
              }}
            >
              <option value="standard">Standard</option>
              <option value="google">Google</option>
            </NativeSelect>
            {profile === "google" && (
              <p className="text-muted-foreground">
                Google requires a registered OAuth application. Save this server, then configure its
                application and callback URI.
              </p>
            )}
            <Label htmlFor="mcp-scopes">Requested OAuth scopes (optional)</Label>
            <Input
              id="mcp-scopes"
              name="scopes"
              defaultValue={
                server?.authConfig.kind === "oauth"
                  ? server.authConfig.requestedScopes.join(" ")
                  : ""
              }
            />
          </>
        )}
        <Label>
          <input type="checkbox" name="enabled" defaultChecked={server?.enabled ?? true} /> Enabled
        </Label>
        {server && (
          <p className="text-muted-foreground">
            Changing the endpoint or authentication requires existing accounts to reconnect.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit">{busy ? "Saving…" : "Save server"}</Button>
        </div>
      </fieldset>
    </form>
  )
}
