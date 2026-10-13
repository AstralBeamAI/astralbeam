import { useCallback, useId, useState } from "react"
import type {
  McpConnectionEncoded,
  McpServerEncoded,
  McpConnectionInputEncoded,
} from "../../api/generated/api.ts"
import { Button } from "./ui/button.tsx"
import { Input } from "./ui/input.tsx"
import { NativeSelect } from "./ui/native-select.tsx"

export function McpAccountEditor({
  account,
  servers,
  busy,
  save,
  cancel,
}: {
  account: McpConnectionEncoded | null
  servers: readonly McpServerEncoded[]
  busy: boolean
  save: (fields: McpConnectionInputEncoded) => void
  cancel: () => void
}) {
  const fieldId = useId()
  const focusName = useCallback((element: HTMLInputElement | null) => element?.focus(), [])
  const [serverId, setServerId] = useState(account?.server_id ?? servers[0]?.id ?? "")
  const [error, setError] = useState("")
  const server = servers.find((entry) => entry.id === serverId)
  const headerNames =
    server?.auth_config.kind === "static_headers" ? server.auth_config.header_names : []
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
          server_id: server.id,
          server_tenant_id: server.tenant_id,
          enabled: form.has("enabled"),
          ...(account ? { lock_version: account.lock_version } : {}),
          ...(replace ? { headers: Object.fromEntries(values) } : {}),
        })
      }}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <h3 className="font-medium">{account ? "Edit account" : "Add account"}</h3>
        <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-name`}>
          Account name
          <Input
            ref={focusName}
            id={`${fieldId}-name`}
            name="name"
            required
            defaultValue={account?.name}
            placeholder="Work account"
          />
        </label>
        <label className="grid gap-1 text-xs" htmlFor={`${fieldId}-server`}>
          Server
          <NativeSelect
            className="w-full"
            id={`${fieldId}-server`}
            value={serverId}
            disabled={!!account}
            onChange={(event) => {
              setServerId(event.currentTarget.value)
              setError("")
            }}
          >
            {servers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {!entry.enabled ? " (paused)" : ""}
              </option>
            ))}
          </NativeSelect>
        </label>
        {server?.auth_config.kind === "none" && (
          <p className="text-xs text-muted-foreground">
            This server is public. No credentials are needed.
          </p>
        )}
        {server?.auth_config.kind === "oauth" && (
          <p className="text-xs text-muted-foreground">
            Save this account, then select Connect account to authorize it with the provider.
          </p>
        )}
        {headerNames.length > 0 && (
          <div className="grid gap-3" key={serverId}>
            <p className="text-xs text-muted-foreground">
              {account
                ? "Leave all values empty to keep the current credentials. To replace them, enter every value below."
                : "Enter the values required by this server. They will be stored securely."}
            </p>
            {headerNames.map((name, index) => (
              <label className="grid gap-1 text-xs" key={name} htmlFor={`${fieldId}-${index}`}>
                {name} value
                <Input
                  id={`${fieldId}-${index}`}
                  name={`header-${index}`}
                  type="password"
                  autoComplete="off"
                  required={!account}
                  placeholder={name.toLowerCase() === "authorization" ? "Bearer …" : ""}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${fieldId}-error` : undefined}
                  onChange={() => setError("")}
                />
              </label>
            ))}
            {error && (
              <p role="alert" id={`${fieldId}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        )}
        <label className="flex gap-2 text-xs">
          <input name="enabled" type="checkbox" defaultChecked={account?.enabled ?? true} />
          Available to agents
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={!server}>
            {busy ? "Saving…" : "Save account"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
