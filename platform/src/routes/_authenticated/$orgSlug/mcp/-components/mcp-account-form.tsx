import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import type {
  McpConnectionSummary,
  McpConnectionWriteSchema,
  McpServerSummary,
} from "@/lib/mcp/schemas"

export function McpAccountForm({
  connection,
  servers,
  busy,
  save,
  cancel,
}: {
  connection: McpConnectionSummary | null
  servers: readonly McpServerSummary[]
  busy: boolean
  save: (fields: typeof McpConnectionWriteSchema.Type) => void
  cancel: () => void
}) {
  const [serverId, setServerId] = useState(
    connection?.serverId ?? servers.find((entry) => entry.enabled)?.id ?? "",
  )
  const [error, setError] = useState("")
  const server = servers.find((entry) => entry.id === serverId)
  const headerNames =
    server?.authConfig.kind === "static_headers" ? server.authConfig.headerNames : []
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (!server) return
        const form = new FormData(event.currentTarget)
        const values = headerNames.map(
          (name, index) => [name, form.get(`header-${index}`) as string] as const,
        )
        const replace = values.some(([, value]) => value.length > 0)
        if (replace && values.some(([, value]) => !value.trim())) {
          setError("Enter every header value to replace the stored credentials.")
          return
        }
        setError("")
        save({
          name: form.get("name") as string,
          serverId,
          serverTenantId: null,
          enabled: form.has("enabled"),
          ...(connection ? { lockVersion: connection.lockVersion } : {}),
          ...(replace ? { headers: Object.fromEntries(values) } : {}),
        })
      }}
    >
      <fieldset disabled={busy} className="grid gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="mcp-account">Account name</Label>
          <Input
            id="mcp-account"
            name="name"
            required
            defaultValue={connection?.name}
            placeholder="Work account"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mcp-server">Server</Label>
          <NativeSelect
            className="w-full"
            id="mcp-server"
            value={serverId}
            disabled={!!connection}
            onChange={(event) => {
              setServerId(event.currentTarget.value)
              setError("")
            }}
          >
            {servers.map((entry) => (
              <option key={entry.id} value={entry.id} disabled={!connection && !entry.enabled}>
                {entry.name}
                {!entry.enabled ? " (paused)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        {server?.authConfig.kind === "none" && (
          <p className="text-muted-foreground">This server is public. No credentials are needed.</p>
        )}
        {server?.authConfig.kind === "oauth" && (
          <p className="text-muted-foreground">
            Save this account, then select Connect account to authorize it with the provider.
          </p>
        )}
        {headerNames.length > 0 && (
          <div className="grid gap-3" key={serverId}>
            <p className="text-muted-foreground">
              {connection
                ? "Leave all values empty to keep the current credentials. To replace them, enter every value below."
                : "Enter the values required by this server. They will be stored securely."}
            </p>
            {headerNames.map((name, index) => (
              <div className="space-y-1.5" key={name}>
                <Label htmlFor={`mcp-header-${index}`}>{name} value</Label>
                <Input
                  id={`mcp-header-${index}`}
                  name={`header-${index}`}
                  type="password"
                  autoComplete="off"
                  required={!connection}
                  placeholder={name.toLowerCase() === "authorization" ? "Bearer …" : ""}
                  aria-invalid={!!error}
                  aria-describedby={error ? "mcp-header-error" : undefined}
                  onChange={() => setError("")}
                />
              </div>
            ))}
            {error && (
              <p role="alert" id="mcp-header-error" className="text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <Label>
          <input type="checkbox" name="enabled" defaultChecked={connection?.enabled ?? true} />{" "}
          Available to agents
        </Label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={cancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={!server || (!connection && !server.enabled)}>
            {busy ? "Saving…" : "Save account"}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
