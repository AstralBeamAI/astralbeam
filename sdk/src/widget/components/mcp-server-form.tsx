import { useCallback, useId, useState } from "react"
import type { McpServerEncoded, McpServerInputEncoded } from "../../api/generated/api.ts"
import { Button } from "./ui/button.tsx"
import { Input } from "./ui/input.tsx"
import { NativeSelect } from "./ui/native-select.tsx"

export function McpServerEditor({
  server,
  shared,
  busy,
  save,
  cancel,
}: {
  server: McpServerEncoded | null
  shared: boolean
  busy: boolean
  save: (fields: McpServerInputEncoded) => void
  cancel: () => void
}) {
  const fieldId = useId()
  const focusName = useCallback((element: HTMLInputElement | null) => element?.focus(), [])
  const [authentication, setAuthentication] = useState(server?.auth_config.kind ?? "none")
  const [google, setGoogle] = useState(
    server?.auth_config.kind === "oauth" && server.auth_config.profile === "google",
  )
  const [manual, setManual] = useState(
    server?.auth_config.kind === "oauth" && server.auth_config.registration === "pre_registered",
  )
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        save({
          name: form.get("name") as string,
          endpoint_url: form.get("endpoint") as string,
          enabled: form.has("enabled"),
          default_connection_scope: shared ? "tenant" : "tenant_user",
          auth_config:
            authentication === "none"
              ? { kind: "none" }
              : authentication === "static_headers"
                ? {
                    kind: "static_headers",
                    header_names: (form.get("headers") as string)
                      .split(",")
                      .map((name) => name.trim())
                      .filter(Boolean),
                  }
                : {
                    kind: "oauth",
                    registration: google || manual ? "pre_registered" : "automatic",
                    profile: google ? "google" : "standard",
                    requested_scopes: (form.get("scopes") as string).split(/\s+/).filter(Boolean),
                  },
          ...(server ? { lock_version: server.lock_version } : {}),
        })
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <h3 className="font-medium">{server ? "Edit server" : "Add custom server"}</h3>
        <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-name`}>
          Server name
          <Input
            ref={focusName}
            id={`${fieldId}-name`}
            name="name"
            required
            defaultValue={server?.name}
          />
        </label>
        <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-endpoint`}>
          Public HTTPS endpoint
          <Input
            id={`${fieldId}-endpoint`}
            name="endpoint"
            type="url"
            required
            defaultValue={server?.endpoint_url}
            placeholder="https://example.com/mcp"
          />
        </label>
        <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-auth`}>
          Authentication
          <NativeSelect
            className="w-full"
            id={`${fieldId}-auth`}
            value={authentication}
            onChange={(event) =>
              setAuthentication(
                event.currentTarget.value as McpServerInputEncoded["auth_config"]["kind"],
              )
            }
          >
            <option value="none">Public</option>
            <option value="static_headers">API key / static headers</option>
            <option value="oauth">OAuth</option>
          </NativeSelect>
        </label>
        {authentication === "static_headers" && (
          <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-headers`}>
            Header names, comma separated
            <Input
              id={`${fieldId}-headers`}
              name="headers"
              required
              defaultValue={
                server?.auth_config.kind === "static_headers"
                  ? server.auth_config.header_names.join(", ")
                  : ""
              }
              placeholder="Authorization, X-Api-Key"
            />
          </label>
        )}
        {authentication === "oauth" && (
          <>
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={google}
                onChange={(event) => {
                  setGoogle(event.currentTarget.checked)
                  if (event.currentTarget.checked) setManual(true)
                }}
              />
              Google
            </label>
            {google && (
              <p className="text-xs text-muted-foreground">
                Google requires a registered OAuth application. You can configure it when connecting
                an account.
              </p>
            )}
            <label className="flex gap-2 text-xs">
              <input
                type="checkbox"
                checked={google || manual}
                disabled={google}
                onChange={(event) => setManual(event.currentTarget.checked)}
              />
              Use a registered OAuth application
            </label>
            <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-scopes`}>
              OAuth scopes (optional)
              <Input
                id={`${fieldId}-scopes`}
                name="scopes"
                defaultValue={
                  server?.auth_config.kind === "oauth"
                    ? server.auth_config.requested_scopes.join(" ")
                    : ""
                }
              />
            </label>
          </>
        )}
        <label className="flex gap-2 text-xs">
          <input name="enabled" type="checkbox" defaultChecked={server?.enabled ?? true} />
          Available to agents
        </label>
        {server && (
          <p className="text-xs text-muted-foreground">
            Changing the endpoint or authentication requires existing accounts to reconnect.
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            {busy ? "Saving…" : "Save server"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
