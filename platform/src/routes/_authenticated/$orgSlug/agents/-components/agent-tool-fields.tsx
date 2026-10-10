import { Link } from "@tanstack/react-router"
import type { AgentSandboxProvider } from "@/lib/agents/agents.server"
import type { ModelChoice } from "@/lib/model-providers/model-providers.server"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function AgentToolFields({
  organizationSlug,
  models,
  webAccessEnabled,
  onWebAccessChange,
  sandboxEnabled,
  onSandboxChange,
  sandboxProviderId,
  onSandboxProviderChange,
  sandboxProviders,
  disabled,
}: {
  organizationSlug: string
  models: readonly ModelChoice[]
  webAccessEnabled: boolean
  onWebAccessChange: (enabled: boolean) => void
  sandboxEnabled: boolean
  onSandboxChange: (enabled: boolean) => void
  sandboxProviderId: string | null
  onSandboxProviderChange: (id: string | null) => void
  sandboxProviders: readonly AgentSandboxProvider[]
  disabled: boolean
}) {
  const incompatible = webAccessEnabled
    ? models.filter((model) => model.webAccess.available === false)
    : []
  const providerItems = sandboxProviders.map((provider) => ({
    label: `${provider.name} (${provider.providerType})`,
    value: provider.id,
  }))
  return (
    <FieldGroup>
      <div className="space-y-3">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="agent-web-access-enabled">Web access</FieldLabel>
            <FieldDescription id="agent-web-access-description">
              Search the web and read public pages.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-web-access-enabled"
            checked={webAccessEnabled}
            onCheckedChange={onWebAccessChange}
            disabled={disabled}
            aria-invalid={incompatible.length > 0 || undefined}
            aria-describedby={
              incompatible.length
                ? "agent-web-access-description agent-web-access-error"
                : "agent-web-access-description"
            }
          />
        </Field>
        {webAccessEnabled && (
          <div className="space-y-2 border-s-2 ps-3">
            <FieldDescription>
              Uses the selected model connection. Provider charges may apply.
            </FieldDescription>
            {models.some((model) => model.webAccess.available === null) && (
              <FieldDescription>
                The connection will verify Web access for custom models or API URLs when they are
                used.
              </FieldDescription>
            )}
            {incompatible.length > 0 && (
              <FieldError id="agent-web-access-error">
                <ul className="space-y-2">
                  {incompatible.map((model) => (
                    <li key={model.id}>
                      {model.name} ({model.providerName}): {model.webAccess.reason}
                    </li>
                  ))}
                </ul>
              </FieldError>
            )}
          </div>
        )}
      </div>
      <div className="space-y-3 border-t pt-5">
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="agent-sandbox-enabled">Sandbox</FieldLabel>
            <FieldDescription id="agent-sandbox-description">
              Run code and work with files in an isolated environment.
            </FieldDescription>
          </FieldContent>
          <Switch
            id="agent-sandbox-enabled"
            checked={sandboxEnabled}
            onCheckedChange={onSandboxChange}
            disabled={disabled}
            aria-describedby="agent-sandbox-description"
          />
        </Field>
        {sandboxEnabled && (
          <div className="border-s-2 ps-3">
            <Field data-invalid={!sandboxProviderId || undefined}>
              <FieldLabel htmlFor="agent-sandbox-provider">Connection</FieldLabel>
              <Select
                items={providerItems}
                value={sandboxProviderId}
                onValueChange={onSandboxProviderChange}
                disabled={disabled}
              >
                <SelectTrigger
                  id="agent-sandbox-provider"
                  className="w-full"
                  aria-invalid={!sandboxProviderId || undefined}
                  aria-describedby="agent-sandbox-provider-description agent-sandbox-provider-error"
                >
                  <SelectValue placeholder="Choose a sandbox connection" />
                </SelectTrigger>
                <SelectContent>
                  {providerItems.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription id="agent-sandbox-provider-description">
                {sandboxProviders.length ? (
                  "One isolated sandbox per conversation."
                ) : (
                  <>
                    Configure a connection in{" "}
                    <Link to="/$orgSlug/sandboxes" params={{ orgSlug: organizationSlug }}>
                      Sandboxes
                    </Link>{" "}
                    first.
                  </>
                )}
              </FieldDescription>
              {!sandboxProviderId && (
                <FieldError id="agent-sandbox-provider-error">
                  Choose a sandbox connection to enable Sandbox.
                </FieldError>
              )}
            </Field>
          </div>
        )}
      </div>
      <FieldDescription className="border-t pt-5">
        Your application can supply additional tools for each conversation.
      </FieldDescription>
    </FieldGroup>
  )
}
