"use client"

import { useNavigate, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"

import { GeneratedSlugField } from "@/components/generated-slug-field"
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
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import type { AgentSandboxProviderSummary, OrganizationAgent } from "@/db/agent.server"
import { isValidSlug } from "@/lib/slug"
import { checkAgentSlugAvailability } from "../-functions/check-agent-slug-availability"
import { createAgent } from "../-functions/create-agent"
import { updateAgent } from "../-functions/update-agent"
import { agentPublicId, agentRequestFailedToast } from "../-lib/utils"

/** Stands in for a null provider, which the Select cannot represent with an empty value. */
const NO_SANDBOX_PROVIDER = "none"

const AGENT_NAME_MAX_LENGTH = 100
const AGENT_SYSTEM_PROMPT_MAX_LENGTH = 32_768

export type AgentFormProps = {
  organizationSlug: string
  /** Null on the create page, where the identifier is still being chosen. */
  agent: OrganizationAgent | null
  sandboxProviders: readonly AgentSandboxProviderSummary[]
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
  const [availability, setAvailability] = useState<
    "available" | "checking" | "idle" | "invalid" | "unavailable"
  >("idle")
  const [saving, setSaving] = useState(false)

  // Base UI resolves the trigger's label from `items`, not from the rendered options.
  const sandboxProviderItems = [
    { label: "None", value: NO_SANDBOX_PROVIDER },
    ...sandboxProviders.map((provider) => ({
      label: `${provider.name} (${provider.providerType})`,
      value: provider.id,
    })),
  ]
  const selectedSandboxProviderId = sandboxProviderId === NO_SANDBOX_PROVIDER
    ? null
    : sandboxProviderId
  const normalizedName = name.trim()
  const valid = normalizedName.length > 0 && normalizedName.length <= AGENT_NAME_MAX_LENGTH &&
    systemPrompt.length > 0 && systemPrompt.length <= AGENT_SYSTEM_PROMPT_MAX_LENGTH &&
    (existing !== null || (availability !== "invalid" && availability !== "unavailable"))

  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid || readOnly) return
    const slug = new FormData(event.currentTarget).get("slug")
    if (existing === null && (typeof slug !== "string" || !isValidSlug(slug))) return
    setSaving(true)
    try {
      const fields = {
        organizationSlug,
        name: normalizedName,
        systemPrompt,
        attachmentsEnabled,
        sandboxProviderId: selectedSandboxProviderId,
      }
      const result = existing
        ? await updateAgent({
          data: { ...fields, id: existing.id, lockVersion: existing.lockVersion },
        })
        : await createAgent({ data: { ...fields, slug: slug as string } })
      toast.add({
        title: result.ok ? (existing ? "Agent saved" : "Agent created") : result.message,
        type: result.ok ? "success" : "error",
      })
      if (!result.ok) {
        if (result.code === "stale") await router.invalidate()
        return
      }
      if (existing) {
        await router.invalidate()
        return
      }
      await navigate({
        to: "/$orgSlug/agents/$agentSlug",
        params: { orgSlug: organizationSlug, agentSlug: slug as string },
        replace: true,
      })
    } catch {
      agentRequestFailedToast()
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
              : "Choose a permanent public agent ID."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="agent-name">Name</FieldLabel>
              <Input
                id="agent-name"
                value={name}
                required
                maxLength={AGENT_NAME_MAX_LENGTH}
                disabled={disabled}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            {existing
              ? (
                <Field>
                  <FieldLabel htmlFor="agent-public-id">Agent ID</FieldLabel>
                  <Input
                    id="agent-public-id"
                    value={agentPublicId(organizationSlug, existing.slug)}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <FieldDescription>This identifier cannot be changed.</FieldDescription>
                </Field>
              )
              : (
                <GeneratedSlugField
                  id="agent-identifier"
                  label="Identifier"
                  sourceValue={name}
                  fallback="agent"
                  checkAvailability={(slug) =>
                    checkAgentSlugAvailability({ data: { organizationSlug, slug } })}
                  onAvailabilityChange={setAvailability}
                  formatPreview={(slug) => agentPublicId(organizationSlug, slug)}
                  disabled={disabled}
                />
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
                The agent's instructions. They are owned here; the SDK cannot override them.
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
              Enforced by the chat endpoint; the SDK hides the composer's attach button when off.
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
            <Button
              type="submit"
              disabled={!valid || saving || availability === "checking"}
            >
              {saving ? "Saving…" : existing ? "Save changes" : "Create agent"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  )
}
