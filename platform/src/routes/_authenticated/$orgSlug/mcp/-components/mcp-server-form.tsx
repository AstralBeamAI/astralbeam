import { type SyntheticEvent, useState } from "react"
import { Result, Schema, SchemaIssue } from "effect"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { MCP_PROTOCOL_VERSION, McpServerWriteSchema, type McpAuthConfig } from "@/lib/mcp/schemas"
import { validationParseOptions } from "@/lib/schemas"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"

const formatMcpServerIssues = SchemaIssue.makeFormatterStandardSchemaV1()

export function McpServerForm({
  busy,
  callbackUri,
  save,
  cancel,
}: {
  busy: boolean
  callbackUri: string | null
  save: (fields: typeof McpServerWriteSchema.Type) => Promise<unknown>
  cancel: () => void
}) {
  const [authentication, setAuthentication] = useState<McpAuthConfig["kind"]>("none")
  const [oauthSetup, setOauthSetup] = useState("automatic")
  const [issues, setIssues] = useState<ReturnType<typeof formatMcpServerIssues>["issues"]>([])
  const fieldErrors = (field: string) => issues.filter((issue) => issue.path?.includes(field))
  const saveMcpServer = async (event: SyntheticEvent<HTMLFormElement>) => {
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
                    },
                  }
                : {}),
            }
    const input = Schema.decodeUnknownResult(
      McpServerWriteSchema,
      validationParseOptions,
    )({
      endpointUrl: fields.get("endpoint"),
      authConfig,
    })
    if (Result.isFailure(input)) {
      setIssues(formatMcpServerIssues(input.failure.issue).issues)
      return
    }
    try {
      await save(input.success)
    } catch (error) {
      if (parseServerFnError(error).tag === "McpInvalidConfiguration")
        setIssues([
          {
            path: ["endpointUrl"],
            message: "Use a public HTTPS URL without credentials or a fragment",
          },
        ])
    }
  }
  return (
    <form
      className="grid gap-3"
      onChange={() => setIssues([])}
      onSubmit={(event) => void saveMcpServer(event)}
    >
      <fieldset disabled={busy} className="grid gap-3">
        <Label htmlFor="mcp-endpoint">Server URL</Label>
        <Input
          id="mcp-endpoint"
          type="url"
          name="endpoint"
          required
          placeholder="https://mcp.example.com/mcp"
          aria-invalid={fieldErrors("endpointUrl").length > 0}
          aria-describedby="mcp-endpoint-help mcp-endpoint-error"
        />
        <FieldError id="mcp-endpoint-error" errors={fieldErrors("endpointUrl")} />
        <p id="mcp-endpoint-help" className="text-sm text-muted-foreground">
          Public HTTPS endpoint supporting MCP {MCP_PROTOCOL_VERSION} over Streamable HTTP.
        </p>
        <Label htmlFor="mcp-auth">Authentication</Label>
        <NativeSelect
          id="mcp-auth"
          value={authentication}
          onChange={(event) =>
            setAuthentication(event.currentTarget.value as McpAuthConfig["kind"])
          }
        >
          <option value="none">No authentication</option>
          <option value="static_headers">API key / headers</option>
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
              aria-invalid={fieldErrors("headerNames").length > 0}
              aria-describedby="mcp-headers-error"
            />
            <FieldError id="mcp-headers-error" errors={fieldErrors("headerNames")} />
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
              aria-invalid={fieldErrors("applicationOrigin").length > 0}
              aria-describedby="mcp-application-origin-error"
            />
            <FieldError
              id="mcp-application-origin-error"
              errors={fieldErrors("applicationOrigin")}
            />
            <p className="text-sm text-muted-foreground">
              Allow OAuth from your embedded application&apos;s origin. The dashboard origin is
              always allowed.
            </p>
            <Label htmlFor="mcp-scopes">Requested scopes, optional</Label>
            <Input
              id="mcp-scopes"
              name="scopes"
              aria-invalid={fieldErrors("requestedScopes").length > 0}
              aria-describedby="mcp-scopes-error"
            />
            <FieldError id="mcp-scopes-error" errors={fieldErrors("requestedScopes")} />
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
                <Input
                  id="mcp-client"
                  name="clientId"
                  required
                  aria-invalid={fieldErrors("clientId").length > 0}
                  aria-describedby="mcp-client-error"
                />
                <FieldError id="mcp-client-error" errors={fieldErrors("clientId")} />
                <Label htmlFor="mcp-secret">
                  {oauthSetup === "google" ? "Client secret" : "Client secret, if required"}
                </Label>
                <Input
                  id="mcp-secret"
                  name="secret"
                  type="password"
                  autoComplete="off"
                  required={oauthSetup === "google"}
                  aria-invalid={fieldErrors("clientSecret").length > 0}
                  aria-describedby="mcp-secret-error"
                />
                <FieldError id="mcp-secret-error" errors={fieldErrors("clientSecret")} />
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
          <Button type="submit">{busy ? "Saving…" : "Add MCP server"}</Button>
        </div>
      </fieldset>
    </form>
  )
}
