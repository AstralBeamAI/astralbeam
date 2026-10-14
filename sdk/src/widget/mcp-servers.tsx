import { useId, useState, type ComponentProps, type SyntheticEvent } from "react"
import { createRoot } from "react-dom/client"
import { PlugIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import type {
  McpServerFormError,
  McpServerInput,
  MountAstralBeamMcpServersOptions,
} from "../client/mcp-servers.ts"
import { Button } from "./components/ui/button.tsx"
import { Badge } from "./components/ui/badge.tsx"
import { Input } from "./components/ui/input.tsx"
import { NativeSelect } from "./components/ui/native-select.tsx"
import { chatStyles } from "./styles.generated.ts"

export function renderMcpServers(
  container: HTMLElement,
  options: MountAstralBeamMcpServersOptions,
) {
  const root = createRoot(container)
  const update = (next: MountAstralBeamMcpServersOptions) =>
    root.render(
      <>
        <style>{chatStyles}</style>
        <McpServers {...next} />
      </>,
    )
  update(options)
  return { update, unmount: () => root.unmount() }
}

function McpServers(options: MountAstralBeamMcpServersOptions) {
  const [adding, setAdding] = useState(false)
  const [removal, setRemoval] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const remove = async (id: string) => {
    setBusy(true)
    setError("")
    try {
      await options.onRemoveServer?.(id)
      setRemoval(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not remove the server")
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-4 bg-background text-foreground" data-slot="mcp-servers">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Available servers</h2>
        {options.onCreateServer && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon /> Add MCP server
          </Button>
        )}
      </div>
      {adding && options.onCreateServer && (
        <McpServerForm
          oauthRedirectUri={options.oauthRedirectUri}
          save={options.onCreateServer}
          close={() => setAdding(false)}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {options.servers.length === 0 && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No MCP servers are available.
        </p>
      )}
      <div className="divide-y rounded-lg border empty:hidden">
        {options.servers.map((server) => (
          <article key={server.id} className="px-3 py-2.5">
            <div className="flex items-center gap-3">
              <PlugIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-medium">
                  {new URL(server.endpointUrl).hostname}
                </h3>
                <p className="truncate text-xs text-muted-foreground" title={server.endpointUrl}>
                  {server.endpointUrl}
                </p>
              </div>
              <Badge variant="secondary">
                {server.authKind
                  ? { none: "Public", oauth: "OAuth", static_headers: "API key" }[server.authKind]
                  : "Unavailable"}
              </Badge>
              {options.onRemoveServer && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove server: ${new URL(server.endpointUrl).hostname}`}
                  title="Remove server"
                  onClick={() => {
                    setError("")
                    setRemoval(server.id)
                  }}
                >
                  <TrashIcon />
                </Button>
              )}
            </div>
            {removal === server.id && options.onRemoveServer && (
              <div className="mt-3 grid gap-2 text-sm" role="group" aria-label="Remove server?">
                <p>
                  Remove this server and its connections? People will need to connect again if it is
                  added later.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRemoval(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void remove(server.id)}
                  >
                    Remove server
                  </Button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}

function McpServerForm({
  oauthRedirectUri,
  save,
  close,
}: {
  oauthRedirectUri: string | null | undefined
  save: NonNullable<MountAstralBeamMcpServersOptions["onCreateServer"]>
  close: () => void
}) {
  const id = useId()
  const [authentication, setAuthentication] = useState<McpServerInput["authConfig"]["kind"]>("none")
  const [oauthSetup, setOauthSetup] = useState("automatic")
  const [issues, setIssues] = useState<readonly McpServerFormError[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const field = (name: string, label: string, props: ComponentProps<typeof Input> = {}) => {
    const errors = issues.filter((issue) => issue.field === name)
    return (
      <div className="grid gap-1.5 text-sm">
        <label htmlFor={`${id}-${name}`}>{label}</label>
        <Input
          id={`${id}-${name}`}
          name={name}
          aria-invalid={errors.length > 0}
          aria-describedby={errors.length ? `${id}-${name}-error` : undefined}
          {...props}
        />
        {errors.length > 0 && (
          <span id={`${id}-${name}-error`} className="text-destructive">
            {errors.map((issue) => issue.message).join(". ")}
          </span>
        )}
      </div>
    )
  }
  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const value = (name: string) => ((form.get(name) as string | null) ?? "").trim()
    const authConfig: McpServerInput["authConfig"] =
      authentication === "none"
        ? { kind: "none" }
        : authentication === "static_headers"
          ? {
              kind: "static_headers",
              headerNames: value("headerNames")
                .split(",")
                .map((name) => name.trim())
                .filter(Boolean),
            }
          : {
              kind: "oauth",
              profile: oauthSetup === "google" ? "google" : "standard",
              requestedScopes: value("requestedScopes").split(/\s+/).filter(Boolean),
              ...(value("applicationOrigin")
                ? { applicationOrigin: value("applicationOrigin") }
                : {}),
              ...(oauthSetup !== "automatic"
                ? {
                    client: {
                      clientId: value("clientId"),
                      ...(form.get("clientSecret")
                        ? { clientSecret: form.get("clientSecret") as string }
                        : {}),
                    },
                  }
                : {}),
            }
    setBusy(true)
    setError("")
    setIssues([])
    try {
      const result = await save({ endpointUrl: value("endpointUrl"), authConfig })
      if (result?.errors.length) setIssues(result.errors)
      else close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not add the server")
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="grid gap-3 rounded-lg border p-4"
      aria-label="Add MCP server"
      onSubmit={(event) => void submit(event)}
      onChange={() => {
        setIssues([])
        setError("")
      }}
    >
      <fieldset className="grid gap-3" disabled={busy}>
        {field("endpointUrl", "Server URL", {
          type: "url",
          autoFocus: true,
          required: true,
          maxLength: 2048,
          placeholder: "https://mcp.example.com/mcp",
        })}
        <p className="text-xs text-muted-foreground">
          Public HTTPS endpoint using Streamable HTTP.
        </p>
        <label className="grid gap-1.5 text-sm" htmlFor={`${id}-authentication`}>
          Authentication
          <NativeSelect
            id={`${id}-authentication`}
            value={authentication}
            onChange={(event) =>
              setAuthentication(event.currentTarget.value as typeof authentication)
            }
          >
            <option value="none">No authentication</option>
            <option value="static_headers">API key / headers</option>
            <option value="oauth">OAuth</option>
          </NativeSelect>
        </label>
        {authentication === "static_headers" && (
          <>
            {field("headerNames", "Header names, comma separated", {
              required: true,
              placeholder: "Authorization, X-Api-Key",
            })}
            <p className="text-xs text-muted-foreground">
              Values are entered when creating a connection.
            </p>
          </>
        )}
        {authentication === "oauth" && (
          <>
            <label className="grid gap-1.5 text-sm" htmlFor={`${id}-oauth-setup`}>
              OAuth setup
              <NativeSelect
                id={`${id}-oauth-setup`}
                value={oauthSetup}
                onChange={(event) => setOauthSetup(event.currentTarget.value)}
              >
                <option value="automatic">Automatic discovery</option>
                <option value="manual">Pre-registered application</option>
                <option value="google">Google</option>
              </NativeSelect>
            </label>
            {field("applicationOrigin", "Application origin, optional", {
              type: "url",
              maxLength: 2048,
              placeholder: "https://app.example.com",
            })}
            <p className="text-xs text-muted-foreground">
              Allow OAuth from this embedded application&apos;s origin. The dashboard origin is
              always allowed.
            </p>
            {field("requestedScopes", "Requested scopes, optional")}
            {oauthSetup !== "automatic" && (
              <>
                {field("redirectUri", "Redirect URI", {
                  value: oauthRedirectUri ?? "Configure the application URL first",
                  readOnly: true,
                  onFocus: (event) => event.currentTarget.select(),
                })}
                {field("clientId", "Client ID", { required: true, maxLength: 2048 })}
                {field(
                  "clientSecret",
                  oauthSetup === "google" ? "Client secret" : "Client secret, if required",
                  {
                    type: "password",
                    autoComplete: "off",
                    required: oauthSetup === "google",
                    maxLength: 8192,
                  },
                )}
              </>
            )}
          </>
        )}
        <p className="text-xs text-muted-foreground">
          To change the endpoint or authentication later, remove and add the server again.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            {busy ? "Saving…" : "Add MCP server"}
          </Button>
        </div>
      </fieldset>
    </form>
  )
}
