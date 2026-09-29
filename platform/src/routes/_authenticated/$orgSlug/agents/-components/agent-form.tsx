"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"
import { Schema } from "effect"

import type { Agent, AgentSandboxProvider } from "@/lib/agents/agents.server"
import { AgentNameSchema, AgentSystemPromptSchema } from "@/lib/agents/schemas"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"

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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import { createAgent } from "../-functions/create-agent"
import { updateAgent } from "../-functions/update-agent"

/** Stands in for a null provider, which the Select cannot represent with an empty value. */
const NO_SANDBOX_PROVIDER = "none"

const AGENT_NAME_MAX_LENGTH = 100
const AGENT_SYSTEM_PROMPT_MAX_LENGTH = 32_768

export type AgentFormProps = {
  organizationSlug: string
  /** Null on the create page, where the agent's ID does not exist yet. */
  agent: Agent | null
  sandboxProviders: readonly AgentSandboxProvider[]
  readOnly: boolean
}

export function AgentForm({
  organizationSlug,
  agent: existing,
  sandboxProviders,
  readOnly,
}: AgentFormProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "")
  const [attachmentsEnabled, setAttachmentsEnabled] = useState(existing?.attachmentsEnabled ?? true)
  const [sandboxProviderId, setSandboxProviderId] = useState(
    existing?.sandboxProviderId ?? NO_SANDBOX_PROVIDER,
  )
  const [saving, setSaving] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  // Base UI resolves the trigger's label from `items`, not from the rendered options.
  const sandboxProviderItems = [
    { label: "None", value: NO_SANDBOX_PROVIDER },
    ...sandboxProviders.map((provider) => ({
      label: `${provider.name} (${provider.providerType})`,
      value: provider.id,
    })),
  ]
  const selectedSandboxProviderId =
    sandboxProviderId === NO_SANDBOX_PROVIDER ? null : sandboxProviderId
  const normalizedName = name.trim()
  const valid =
    Schema.is(AgentNameSchema)(normalizedName) && Schema.is(AgentSystemPromptSchema)(systemPrompt)

  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || readOnly) return
    setSaving(true)
    setNameError(null)
    const fields = {
      name: normalizedName,
      systemPrompt,
      attachmentsEnabled,
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
    <form onSubmit={(event) => void saveAgent(event)} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{existing ? "Configuration" : "New agent"}</CardTitle>
          <CardDescription>
            {existing
              ? "The agent ID can't change. You can update the other settings."
              : "Name the agent and write its system prompt. Its ID is assigned on creation."}
          </CardDescription>
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

            {existing && (
              <Field>
                <FieldLabel htmlFor="agent-public-id">Agent ID</FieldLabel>
                <Input
                  id="agent-public-id"
                  value={existing.id}
                  readOnly
                  className="font-mono text-xs"
                />
                <FieldDescription>This identifier cannot be changed.</FieldDescription>
              </Field>
            )}

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
                The agent&apos;s instructions. They are owned here; the SDK cannot override them.
              </FieldDescription>
            </Field>

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
              Enforced by the chat endpoint; the SDK hides the composer&apos;s attach button when
              off.
            </FieldDescription>

            <Field>
              <FieldLabel htmlFor="agent-sandbox-provider">Sandbox provider</FieldLabel>
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
                  <SelectItem value={NO_SANDBOX_PROVIDER}>None</SelectItem>
                  {sandboxProviders.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.name} ({provider.providerType})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Optional. An agent with a provider gets one isolated sandbox per conversation.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end gap-2">
            <Button type="submit" disabled={!valid || saving}>
              {saving ? "Saving…" : existing ? "Save changes" : "Create agent"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
