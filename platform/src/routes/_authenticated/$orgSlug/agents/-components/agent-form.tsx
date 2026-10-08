"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"
import { Schema } from "effect"
import type { Agent, AgentSandboxProvider } from "@/lib/agents/agents.server"
import type { ModelChoice } from "@/lib/model-providers/model-providers.server"
import { AgentNameSchema, AgentSystemPromptSchema } from "@/lib/agents/schemas"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { createAgent } from "../-functions/create-agent"
import { updateAgent } from "../-functions/update-agent"
import { AgentModelFields } from "./agent-model-fields"
import { AgentToolFields } from "./agent-tool-fields"

const AGENT_NAME_MAX_LENGTH = 100
const AGENT_SYSTEM_PROMPT_MAX_LENGTH = 32_768

export type AgentFormProps = {
  organizationSlug: string
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
  const initialModel = models.find((model) => model.webAccess.available === true) ?? models[0]
  const initialModelIds = existing ? existing.modelIds : initialModel ? [initialModel.id] : []
  const initialSandboxId = existing ? existing.sandboxProviderId : (sandboxProviders[0]?.id ?? null)
  const [name, setName] = useState(existing?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "")
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(existing?.attachmentsEnabled ?? true)
  const [modelIds, setModelIds] = useState<string[]>([...initialModelIds])
  const [webAccessOverride, setWebAccessOverride] = useState<boolean | null>(
    existing?.webAccessEnabled ?? null,
  )
  const [sandboxEnabled, setSandboxEnabled] = useState(initialSandboxId !== null)
  const [sandboxProviderId, setSandboxProviderId] = useState<string | null>(initialSandboxId)
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const selectedModels = models.filter((model) => modelIds.includes(model.id))
  const webAccessEnabled =
    webAccessOverride ??
    (selectedModels.length > 0 &&
      selectedModels.every((model) => model.webAccess.available === true))
  const selectedSandboxProviderId = sandboxEnabled ? sandboxProviderId : null
  const normalizedName = name.trim()
  const valid =
    Schema.is(AgentNameSchema)(normalizedName) &&
    Schema.is(AgentSystemPromptSchema)(systemPrompt) &&
    modelIds.length > 0 &&
    (!sandboxEnabled || sandboxProviderId !== null) &&
    (!webAccessEnabled || selectedModels.every((model) => model.webAccess.available !== false))
  const dirty =
    normalizedName !== (existing?.name ?? "") ||
    systemPrompt !== (existing?.systemPrompt ?? "") ||
    attachmentsEnabled !== (existing?.attachmentsEnabled ?? true) ||
    JSON.stringify(modelIds) !== JSON.stringify(initialModelIds) ||
    webAccessEnabled !==
      (existing?.webAccessEnabled ?? initialModel?.webAccess.available === true) ||
    sandboxEnabled !== (initialSandboxId !== null) ||
    selectedSandboxProviderId !== initialSandboxId

  const discard = () => {
    setName(existing?.name ?? "")
    setSystemPrompt(existing?.systemPrompt ?? "")
    setAttachmentsEnabled(existing?.attachmentsEnabled ?? true)
    setModelIds([...initialModelIds])
    setWebAccessOverride(existing?.webAccessEnabled ?? null)
    setSandboxEnabled(initialSandboxId !== null)
    setSandboxProviderId(initialSandboxId)
    setNameError(null)
  }
  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || readOnly) return
    setSaving(true)
    setNameError(null)
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
      toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "AgentChanged") await router.invalidate()
    } finally {
      setSaving(false)
    }
  }
  const disabled = saving || readOnly

  return (
    <form onSubmit={(event) => void saveAgent(event)} className="w-full max-w-2xl space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Instructions</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
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
            <Field>
              <FieldLabel htmlFor="agent-system-prompt">System prompt</FieldLabel>
              <Textarea
                id="agent-system-prompt"
                value={systemPrompt}
                required
                maxLength={AGENT_SYSTEM_PROMPT_MAX_LENGTH}
                rows={8}
                disabled={disabled}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
              <FieldDescription>
                Instructions for this agent. Your application cannot override them.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription id="agent-models-description">
            Choose models from your configured providers. The default handles new conversations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentModelFields
            organizationSlug={organizationSlug}
            models={models}
            modelIds={modelIds}
            disabled={disabled}
            onChange={setModelIds}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <CardDescription>Choose what this agent can do.</CardDescription>
        </CardHeader>
        <CardContent>
          <AgentToolFields
            organizationSlug={organizationSlug}
            models={selectedModels}
            webAccessEnabled={webAccessEnabled}
            onWebAccessChange={setWebAccessOverride}
            sandboxEnabled={sandboxEnabled}
            onSandboxChange={setSandboxEnabled}
            sandboxProviderId={sandboxProviderId}
            onSandboxProviderChange={setSandboxProviderId}
            sandboxProviders={sandboxProviders}
            disabled={disabled}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Conversation</CardTitle>
        </CardHeader>
        <CardContent>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="agent-attachments-enabled">File attachments</FieldLabel>
              <FieldDescription id="agent-attachments-description">
                Let users attach files to their messages.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-attachments-enabled"
              checked={attachmentsEnabled}
              disabled={disabled}
              onCheckedChange={setAttachmentsEnabled}
              aria-describedby="agent-attachments-description"
            />
          </Field>
        </CardContent>
      </Card>
      {!readOnly && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground" role="status">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "Changes apply to the next request."}
          </p>
          <div className="ms-auto flex gap-2">
            <Button type="button" variant="outline" disabled={!dirty || saving} onClick={discard}>
              Discard
            </Button>
            <Button type="submit" disabled={!valid || saving || (existing !== null && !dirty)}>
              {saving ? "Saving…" : existing ? "Save changes" : "Create agent"}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
