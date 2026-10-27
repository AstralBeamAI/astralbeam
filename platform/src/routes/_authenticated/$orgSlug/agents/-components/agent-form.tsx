"use client"

import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react"
import { useHydrated, Link, useNavigate, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"
import { Schema } from "effect"

import type { Agent, AgentSandboxProvider } from "@/lib/agents/agents.server"
import type { ModelChoice } from "@/lib/model-providers/model-providers.server"
import { AgentNameSchema, AgentSystemPromptSchema } from "@/lib/agents/schemas"
import { parseServerFnError, type ServerFnError } from "@/lib/runtime/server-fn-error"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DocsLink } from "@/components/docs-link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { createAgent } from "../-functions/create-agent"
import { updateAgent } from "../-functions/update-agent"
import { AgentModelFields } from "./agent-model-fields"

/** Stands in for a null provider, which the Select cannot represent with an empty value. */
const NO_SANDBOX_PROVIDER = "none"

const AGENT_NAME_MAX_LENGTH = 100
const AGENT_SYSTEM_PROMPT_MAX_LENGTH = 32_768

export type AgentFormProps = {
  organizationSlug: string
  /** Null on the create page, where the agent's ID does not exist yet. */
  agent: Agent | null
  sandboxProviders: readonly AgentSandboxProvider[]
  models: readonly ModelChoice[]
  readOnly: boolean
}

export function AgentForm({
  organizationSlug,
  agent: existing,
  sandboxProviders,
  models,
  readOnly,
}: AgentFormProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "")
  const hydrated = useHydrated()
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(existing?.attachmentsEnabled ?? true)
  const [webOverride, setWebOverride] = useState<boolean | null>(existing?.webAccessEnabled ?? null)
  const [sandboxEnabled, setSandboxEnabled] = useState(
    existing ? existing.sandboxProviderId !== null : sandboxProviders.length > 0,
  )
  const [sandboxProviderId, setSandboxProviderId] = useState(
    existing?.sandboxProviderId ?? sandboxProviders[0]?.id ?? NO_SANDBOX_PROVIDER,
  )
  const initialModel = models.find((model) => model.webAccess === true) ?? models[0]
  const [modelIds, setModelIds] = useState<string[]>([
    ...(existing?.modelIds ?? (initialModel ? [initialModel.id] : [])),
  ])
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<ServerFnError | null>(null)
  const conflicted = saveError?.tag === "AgentChanged"

  // Base UI resolves the trigger's label from `items`, not from the rendered options.
  const sandboxProviderItems = sandboxProviders.map((provider) => ({
    label: `${provider.name} (${provider.providerType})`,
    value: provider.id,
  }))
  const selectedSandboxProviderId =
    sandboxEnabled && sandboxProviderId !== NO_SANDBOX_PROVIDER ? sandboxProviderId : null
  const selectedModel = models.find((model) => model.id === modelIds[0])
  const webAvailable = selectedModel !== undefined && selectedModel.webAccess !== false
  const webAccessEnabled = webOverride ?? selectedModel?.webAccess === true
  const normalizedName = name.trim()
  const valid =
    Schema.is(AgentNameSchema)(normalizedName) &&
    Schema.is(AgentSystemPromptSchema)(systemPrompt) &&
    modelIds.length > 0 &&
    (!webAccessEnabled || webAvailable) &&
    (!sandboxEnabled || selectedSandboxProviderId !== null)

  const disabled = !hydrated || saving || readOnly

  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled || !valid || conflicted) return
    setSaving(true)
    setNameError(null)
    setSaveError(null)
    const fields = {
      name: normalizedName,
      systemPrompt,
      attachmentsEnabled,
      webAccessEnabled,
      modelIds,
      sandboxProviderId: selectedSandboxProviderId,
    }
    try {
      if (existing) {
        await updateAgent({
          data: {
            organizationSlug,
            agentId: existing.id,
            lockVersion: existing.lockVersion,
            fields,
          },
        })
        toast.add({ title: "Agent saved", type: "success" })
        await router.invalidate()
        return
      }
      const agentId = await createAgent({ data: { organizationSlug, fields } })
      toast.add({ title: "Agent created", type: "success" })
      await navigate({
        to: "/$orgSlug/agents/$agentId",
        params: { orgSlug: organizationSlug, agentId },
        replace: true,
      })
    } catch (error) {
      const failure = parseServerFnError(error)
      if (failure.tag === "AgentNameTaken") {
        setNameError(failure.message)
        return
      }
      setSaveError(failure)
    } finally {
      setSaving(false)
    }
  }

  const dirty =
    existing !== null &&
    (name !== existing.name ||
      systemPrompt !== existing.systemPrompt ||
      attachmentsEnabled !== existing.attachmentsEnabled ||
      webAccessEnabled !== (existing.webAccessEnabled ?? selectedModel?.webAccess === true) ||
      selectedSandboxProviderId !== existing.sandboxProviderId ||
      JSON.stringify(modelIds) !== JSON.stringify(existing.modelIds))
  const discardChanges = () => {
    if (!existing) return
    setName(existing.name)
    setSystemPrompt(existing.systemPrompt)
    setAttachmentsEnabled(existing.attachmentsEnabled)
    setWebOverride(existing.webAccessEnabled)
    setModelIds([...existing.modelIds])
    setSandboxEnabled(existing.sandboxProviderId !== null)
    setSandboxProviderId(existing.sandboxProviderId ?? NO_SANDBOX_PROVIDER)
    setNameError(null)
    if (!conflicted) setSaveError(null)
  }

  return (
    <form method="post" onSubmit={(event) => void saveAgent(event)} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{existing ? "Configuration" : "New agent"}</CardTitle>
          <CardDescription>
            {existing
              ? "Update this agent’s instructions, models, and capabilities."
              : "Give your agent a name, instructions, and a model."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <FieldSet>
              <FieldLegend>Identity</FieldLegend>
              <Field data-invalid={nameError !== null || undefined}>
                <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                <Input
                  id="agent-name"
                  value={name}
                  required
                  maxLength={AGENT_NAME_MAX_LENGTH}
                  disabled={disabled}
                  aria-invalid={nameError !== null || undefined}
                  aria-describedby={nameError ? "agent-name-error" : undefined}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameError(null)
                  }}
                />
                <FieldError id="agent-name-error">{nameError}</FieldError>
                <FieldDescription>Unique within this organization.</FieldDescription>
              </Field>
            </FieldSet>

            <FieldSet>
              <FieldLegend>Instructions</FieldLegend>
              <Field>
                <FieldLabel htmlFor="agent-system-prompt">System prompt</FieldLabel>
                <Textarea
                  id="agent-system-prompt"
                  value={systemPrompt}
                  required
                  maxLength={AGENT_SYSTEM_PROMPT_MAX_LENGTH}
                  rows={12}
                  disabled={disabled}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <FieldDescription>
                  Describe the agent’s purpose, how it should respond, and what it should avoid.{" "}
                  <DocsLink href="/docs/dashboard/agents#the-system-prompt">
                    How system prompts work
                  </DocsLink>
                </FieldDescription>
              </Field>
            </FieldSet>

            <AgentModelFields
              organizationSlug={organizationSlug}
              models={models}
              modelIds={modelIds}
              disabled={disabled}
              onChange={setModelIds}
            />

            <FieldSet>
              <FieldLegend>Capabilities</FieldLegend>
              <FieldDescription>Choose what this agent can do.</FieldDescription>
              <Field orientation="horizontal">
                <Checkbox
                  id="agent-attachments-enabled"
                  checked={attachmentsEnabled}
                  disabled={disabled}
                  onCheckedChange={(next) => setAttachmentsEnabled(next === true)}
                />
                <FieldLabel htmlFor="agent-attachments-enabled" className="font-normal">
                  Allow file attachments
                </FieldLabel>
              </Field>
              <FieldDescription>
                Let people attach files when chatting with this agent.{" "}
                <DocsLink href="/docs/sdk/attachments#how-a-file-reaches-the-agent">
                  File handling and sandbox requirements
                </DocsLink>
              </FieldDescription>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="agent-web-access">Web access</FieldLabel>
                  <FieldDescription id="agent-web-access-description">
                    {!webAvailable
                      ? "Select an OpenAI Responses, Anthropic, xAI Grok, or OpenRouter default model."
                      : selectedModel?.webAccess === null
                        ? "For custom models and endpoints, enable only if native web tools are supported."
                        : "Search the web and read public pages through the default model."}{" "}
                    <DocsLink href="/docs/dashboard/agents#web-access">
                      Supported models and web access
                    </DocsLink>
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="agent-web-access"
                  checked={webAccessEnabled}
                  onCheckedChange={setWebOverride}
                  disabled={disabled || (!webAvailable && !webAccessEnabled)}
                  aria-describedby="agent-web-access-description"
                />
              </Field>
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="agent-sandbox-enabled">Sandbox</FieldLabel>
                  <FieldDescription id="agent-sandbox-description">
                    {sandboxProviders.length ? (
                      "Run code and work with files in an isolated environment."
                    ) : (
                      <>
                        Add a connection in{" "}
                        <Link
                          to="/$orgSlug/sandboxes"
                          params={{ orgSlug: organizationSlug }}
                          className="underline"
                        >
                          Sandboxes
                        </Link>{" "}
                        to enable this tool.
                      </>
                    )}{" "}
                    <DocsLink href="/docs/dashboard/agents#sandboxes">
                      How agents use sandboxes
                    </DocsLink>
                  </FieldDescription>
                </FieldContent>
                <Switch
                  id="agent-sandbox-enabled"
                  checked={sandboxEnabled}
                  onCheckedChange={setSandboxEnabled}
                  disabled={disabled || sandboxProviders.length === 0}
                  aria-describedby="agent-sandbox-description"
                />
              </Field>
              {sandboxEnabled && (
                <Field>
                  <FieldLabel htmlFor="agent-sandbox-provider">Sandbox connection</FieldLabel>
                  <Select
                    items={sandboxProviderItems}
                    value={sandboxProviderId}
                    onValueChange={(value) => setSandboxProviderId(value ?? NO_SANDBOX_PROVIDER)}
                    disabled={disabled}
                  >
                    <SelectTrigger id="agent-sandbox-provider" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {sandboxProviders.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {provider.name} ({provider.providerType})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </FieldSet>
          </FieldGroup>
          {saveError && (
            <Alert variant="destructive" className="mt-6">
              <AlertTitle>Could not save agent</AlertTitle>
              <AlertDescription>
                <p>{saveError.message}</p>
                {conflicted && (
                  <p>Reloading replaces your unsaved edits with the latest saved version.</p>
                )}
              </AlertDescription>
              {conflicted && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-2 w-fit"
                  onClick={() => void router.invalidate()}
                >
                  Reload latest
                </Button>
              )}
            </Alert>
          )}
        </CardContent>
        {!readOnly && (
          <CardFooter className="flex-wrap justify-end gap-2">
            {dirty && (
              <span role="status" className="me-auto text-sm text-muted-foreground">
                Unsaved changes
              </span>
            )}
            {existing && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="Discard changes"
                      disabled={!dirty || saving}
                      onClick={discardChanges}
                    />
                  }
                >
                  <ArrowCounterClockwiseIcon aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent>Discard changes</TooltipContent>
              </Tooltip>
            )}
            <Button type="submit" disabled={disabled || !valid || conflicted}>
              {saving ? "Saving…" : existing ? "Save changes" : "Create agent"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
