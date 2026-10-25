import { useId, useState, type ComponentProps, type SyntheticEvent } from "react"
import { createRoot } from "react-dom/client"
import { PlugIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import type {
  McpServerFormError,
  McpServerInput,
  MountAstralBeamMcpServersOptions,
} from "../client/mcp-servers.ts"
import { TooltipButton } from "./components/tooltip-button.tsx"
import { Button } from "./components/ui/button.tsx"
import { Badge } from "./components/ui/badge.tsx"
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "./components/ui/card.tsx"
import { Field, FieldDescription, FieldError, FieldLabel } from "./components/ui/field.tsx"
import { Input } from "./components/ui/input.tsx"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
} from "./components/ui/item.tsx"
import { NativeSelect } from "./components/ui/native-select.tsx"
import { TooltipProvider } from "./components/ui/tooltip.tsx"
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
        <TooltipProvider delay={400}>
          <McpServers {...next} />
        </TooltipProvider>
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
    <section
      className="grid grid-cols-1 gap-2 bg-background text-foreground"
      data-slot="mcp-servers"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-medium">Configured MCP servers</h2>
        {options.onCreateServer && !adding && (
          <Button
            size="sm"
            className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
            onClick={() => setAdding(true)}
          >
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
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          No MCP servers are available.
        </p>
      )}
      <div className="divide-y rounded-lg border bg-card text-card-foreground empty:hidden">
        {options.servers.map((server) => (
          <Item
            key={server.id}
            render={<article />}
            size="xs"
            className="rounded-none border-0 py-1.5"
          >
            <ItemMedia variant="icon" className="text-muted-foreground">
              <PlugIcon aria-hidden />
            </ItemMedia>
            <ItemContent className="min-w-0">
              <h3 className="truncate text-sm font-medium">
                {new URL(server.endpointUrl).hostname}
              </h3>
              <ItemDescription className="line-clamp-none truncate" title={server.endpointUrl}>
                {server.endpointUrl}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="secondary">
                {server.authKind
                  ? { none: "Public", oauth: "OAuth", static_headers: "API key" }[server.authKind]
                  : "Unavailable"}
              </Badge>
              {options.onRemoveServer && (
                <TooltipButton
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`Remove server: ${new URL(server.endpointUrl).hostname}`}
                  tooltip="Remove server"
                  onClick={() => {
                    setError("")
                    setRemoval(server.id)
                  }}
                >
                  <TrashIcon />
                </TooltipButton>
              )}
            </ItemActions>
            {removal === server.id && options.onRemoveServer && (
              <div
                className="grid basis-full gap-2 text-sm"
                role="group"
                aria-label="Remove server?"
              >
                <p>
                  Remove this server and its connections? People will need to connect again if it is
                  added later.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    size="xs"
                    className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setRemoval(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="xs"
                    className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void remove(server.id)}
                  >
                    Remove server
                  </Button>
                </div>
              </div>
            )}
          </Item>
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
  const field = (
    name: string,
    label: string,
    { description, ...props }: ComponentProps<typeof Input> & { description?: string } = {},
  ) => {
    const errors = issues.filter((issue) => issue.field === name)
    return (
      <Field className="gap-1" data-invalid={errors.length > 0}>
        <FieldLabel htmlFor={`${id}-${name}`} className="text-xs">
          {label}
        </FieldLabel>
        <Input
          id={`${id}-${name}`}
          name={name}
          aria-invalid={errors.length > 0}
          aria-describedby={
            [description && `${id}-${name}-help`, errors.length > 0 && `${id}-${name}-error`]
              .filter(Boolean)
              .join(" ") || undefined
          }
          {...props}
        />
        {description && (
          <FieldDescription id={`${id}-${name}-help`} className="text-xs nth-last-2:mt-0">
            {description}
          </FieldDescription>
        )}
        {errors.length > 0 && (
          <FieldError id={`${id}-${name}-error`} className="text-xs">
            {errors.map((issue) => issue.message).join(". ")}
          </FieldError>
        )}
      </Field>
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
              profile: "standard",
              requestedScopes: value("requestedScopes").split(/\s+/).filter(Boolean),
              ...(value("applicationOrigin")
                ? { applicationOrigin: value("applicationOrigin") }
                : {}),
              ...(oauthSetup !== "automatic"
                ? {
                    client: {
                      issuer: value("issuer"),
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
      aria-label="Add MCP server"
      onSubmit={(event) => void submit(event)}
      onChange={() => {
        setIssues([])
        setError("")
      }}
    >
      <fieldset className="min-w-0" disabled={busy}>
        <Card size="sm" className="gap-2.5 text-xs">
          <CardHeader>
            <CardTitle className="text-sm">Add MCP server</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2.5 [&_[data-slot=input]]:text-xs [&_[data-slot=native-select]]:text-xs any-pointer-coarse:[&_input]:min-h-11 any-pointer-coarse:[&_[data-slot=input]]:text-base any-pointer-coarse:[&_[data-slot=native-select]]:text-base any-pointer-coarse:[&_select]:min-h-11">
            {field("endpointUrl", "Server URL", {
              type: "url",
              autoFocus: true,
              required: true,
              maxLength: 2048,
              placeholder: "https://mcp.example.com/mcp",
              description: "Public HTTPS endpoint using Streamable HTTP.",
            })}
            <Field className="gap-1">
              <FieldLabel className="text-xs" htmlFor={`${id}-authentication`}>
                Authentication
              </FieldLabel>
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
            </Field>
            {authentication === "static_headers" &&
              field("headerNames", "Header names, comma separated", {
                required: true,
                placeholder: "Authorization, X-Api-Key",
                description: "Values are entered when creating a connection.",
              })}
            {authentication === "oauth" && (
              <>
                <Field className="gap-1">
                  <FieldLabel className="text-xs" htmlFor={`${id}-oauth-setup`}>
                    OAuth setup
                  </FieldLabel>
                  <NativeSelect
                    id={`${id}-oauth-setup`}
                    value={oauthSetup}
                    onChange={(event) => setOauthSetup(event.currentTarget.value)}
                  >
                    <option value="automatic">Automatic discovery</option>
                    <option value="manual">Pre-registered application</option>
                  </NativeSelect>
                </Field>
                {field("applicationOrigin", "Application origin, optional", {
                  type: "url",
                  maxLength: 2048,
                  placeholder: "https://app.example.com",
                  description:
                    "Allow OAuth from this embedded application's origin. The dashboard origin is always allowed.",
                })}
                {field("requestedScopes", "Requested scopes, optional")}
                {oauthSetup !== "automatic" && (
                  <>
                    {field("redirectUri", "Redirect URI", {
                      value: oauthRedirectUri ?? "Configure the application URL first",
                      readOnly: true,
                      onFocus: (event) => event.currentTarget.select(),
                    })}
                    {field("issuer", "Authorization server issuer", {
                      type: "url",
                      required: true,
                      maxLength: 2048,
                      placeholder: "https://auth.example.com",
                      description: "Use the trusted issuer from your application's OAuth provider.",
                    })}
                    {field("clientId", "Client ID", { required: true, maxLength: 2048 })}
                    {field("clientSecret", "Client secret", {
                      type: "password",
                      autoComplete: "off",
                      maxLength: 8192,
                    })}
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
          </CardContent>
          <CardFooter className="justify-end gap-2 bg-card py-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
              onClick={close}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="any-pointer-coarse:min-h-11 any-pointer-coarse:min-w-11"
            >
              {busy ? "Saving…" : "Add MCP server"}
            </Button>
          </CardFooter>
        </Card>
      </fieldset>
    </form>
  )
}
