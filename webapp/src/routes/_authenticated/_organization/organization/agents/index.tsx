import { CopyIcon, PencilSimpleIcon, PlusIcon, RobotIcon, TrashIcon } from "@phosphor-icons/react"
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router"
import { type SyntheticEvent, useState } from "react"

import { GeneratedSlugField } from "@/components/generated-slug-field"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { APP_NAME } from "@/lib/constants"
import { isValidSlug } from "@/lib/slug"
import { checkOrganizationAgentSlugAvailability } from "./-functions/check-organization-agent-slug-availability.ts"
import { createOrganizationAgentState } from "./-functions/create-organization-agent.ts"
import { deleteOrganizationAgentState } from "./-functions/delete-organization-agent.ts"
import { getOrganizationAgentState } from "./-functions/get-organization-agent-state.ts"
import { updateOrganizationAgentState } from "./-functions/update-organization-agent.ts"
import type {
  AgentSandboxProviderSummary,
  OrganizationAgent,
  OrganizationAgentState,
} from "./-lib/types.ts"

function checkAgentSlug(value: string) {
  return checkOrganizationAgentSlugAvailability({ data: value })
}

export const Route = createFileRoute(
  "/_authenticated/_organization/organization/agents/",
)({
  preload: false,
  gcTime: 0,
  loader: {
    staleReloadMode: "blocking",
    handler: async () => {
      const state = await getOrganizationAgentState()
      if (!state) {
        redirect({ href: "/", replace: true, throw: true })
        throw new Error("TanStack Router redirect did not throw")
      }
      return state
    },
  },
  component: OrganizationAgentsPage,
  pendingComponent: OrganizationAgentsPageSkeleton,
  head: () => ({ meta: [{ title: `Agents · ${APP_NAME}` }] }),
})

function OrganizationAgentsPage() {
  const state = Route.useLoaderData()
  const stateKey = `${state.organizationId}:${
    state.agents.map((agent) => `${agent.id}:${agent.lockVersion}`).join(",")
  }`
  return <OrganizationAgents key={stateKey} state={state} />
}

function OrganizationAgents({ state }: { state: OrganizationAgentState }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(
    state.agents.length === 0 && state.sandboxProviders.length > 0 ? "new" : null,
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const controlsDisabled = editingId !== null || busyId !== null
  const editing = editingId === "new"
    ? null
    : state.agents.find((agent) => agent.id === editingId) ?? null

  const removeAgent = async (agent: OrganizationAgent) => {
    setBusyId(agent.id)
    try {
      const result = await deleteOrganizationAgentState({
        data: { id: agent.id, lockVersion: agent.lockVersion },
      })
      toast.add({
        title: result.ok ? `${agent.name} deleted` : result.message,
        type: result.ok ? "success" : "error",
      })
      await router.invalidate()
    } catch {
      agentRequestFailedToast()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Agents</h1>
          <p className="text-sm text-muted-foreground">
            Give each chat experience its own default instructions and preferred sandbox provider.
          </p>
          <p className="text-sm text-muted-foreground">
            Agent IDs are browser-safe; pass the copied ID as the SDK{" "}
            <code className="font-mono text-foreground">agentId</code>.
          </p>
        </div>
        <Button
          disabled={controlsDisabled || state.sandboxProviders.length === 0}
          onClick={() => setEditingId("new")}
        >
          <PlusIcon aria-hidden="true" />
          Add agent
        </Button>
      </div>

      {state.sandboxProviders.length === 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Configure a sandbox provider first</CardTitle>
            <CardDescription>
              Every agent records an organization provider preference for future sandbox execution.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button render={<Link to="/organization/sandbox-providers" />}>
              Configure sandbox providers
            </Button>
          </CardFooter>
        </Card>
      )}

      {editingId !== null && (
        <OrganizationAgentForm
          key={editingId}
          organizationSlug={state.organizationSlug}
          agent={editing}
          sandboxProviders={state.sandboxProviders}
          onCancel={() => setEditingId(null)}
        />
      )}

      {state.agents.length > 0 && (
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          {state.agents.map((agent) => {
            const publicId = `agt_${state.organizationSlug}_${agent.slug}`
            const provider = state.sandboxProviders.find((item) =>
              item.id === agent.sandboxProviderId
            )
            return (
              <Card key={agent.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <RobotIcon aria-hidden="true" />
                    {agent.name}
                  </CardTitle>
                  <CardDescription>{provider?.name ?? "Provider unavailable"}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-muted-foreground">Agent ID</p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate text-xs">{publicId}</code>
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
                        aria-label={`Copy ${agent.name} agent ID`}
                        title={`Copy ${agent.name} agent ID`}
                        onClick={() => void copyAgentPublicId(publicId)}
                      >
                        <CopyIcon aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                    {agent.systemPrompt}
                  </p>
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={controlsDisabled}
                    onClick={() => setEditingId(agent.id)}
                  >
                    <PencilSimpleIcon aria-hidden="true" />
                    Edit
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          disabled={controlsDisabled}
                          aria-label={`Delete ${agent.name}`}
                        />
                      }
                    >
                      <TrashIcon aria-hidden="true" />
                      Delete
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Its public agent ID will stop working immediately.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void removeAgent(agent)}
                        >
                          Delete agent
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </CardFooter>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function OrganizationAgentForm({
  organizationSlug,
  agent: existing,
  sandboxProviders,
  onCancel,
}: {
  organizationSlug: string
  agent: OrganizationAgent | null
  sandboxProviders: readonly AgentSandboxProviderSummary[]
  onCancel: () => void
}) {
  const router = useRouter()
  const [name, setName] = useState(existing?.name ?? "")
  const [systemPrompt, setSystemPrompt] = useState(existing?.systemPrompt ?? "")
  const [sandboxProviderId, setSandboxProviderId] = useState(
    existing?.sandboxProviderId ?? sandboxProviders[0]?.id ?? "",
  )
  const [availability, setAvailability] = useState<
    "available" | "checking" | "idle" | "invalid" | "unavailable"
  >("idle")
  const [saving, setSaving] = useState(false)
  const sandboxProviderItems = sandboxProviders.map((provider) => ({
    label: `${provider.name} (${provider.providerType})`,
    value: provider.id,
  }))
  const publicId = existing ? `agt_${organizationSlug}_${existing.slug}` : null
  const normalizedName = name.trim()
  const valid = normalizedName.length > 0 && normalizedName.length <= 100 &&
    systemPrompt.length > 0 && systemPrompt.length <= 32_768 && sandboxProviderId.length > 0 &&
    (existing !== null || (availability !== "invalid" && availability !== "unavailable"))

  const saveAgent = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!valid) return
    const slug = new FormData(event.currentTarget).get("slug")
    if (existing === null && (typeof slug !== "string" || !isValidSlug(slug))) return
    setSaving(true)
    try {
      const result = existing
        ? await updateOrganizationAgentState({
          data: {
            id: existing.id,
            lockVersion: existing.lockVersion,
            name: normalizedName,
            systemPrompt,
            sandboxProviderId,
          },
        })
        : await createOrganizationAgentState({
          data: { slug: slug as string, name: normalizedName, systemPrompt, sandboxProviderId },
        })
      toast.add({
        title: result.ok ? (existing ? "Agent saved" : "Agent created") : result.message,
        type: result.ok ? "success" : "error",
      })
      if (result.ok) await router.invalidate()
      else if (result.code === "stale") await router.invalidate()
    } catch {
      agentRequestFailedToast()
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(event) => void saveAgent(event)} className="max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>{existing ? `Edit ${existing.name}` : "Add agent"}</CardTitle>
          <CardDescription>
            {existing
              ? "The agent ID is permanent; update its name, instructions, or provider."
              : "The identifier becomes the permanent public agent ID after creation."}
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
                maxLength={100}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>

            {existing
              ? (
                <Field>
                  <FieldLabel htmlFor="agent-public-id">Agent ID</FieldLabel>
                  <Input
                    id="agent-public-id"
                    value={publicId ?? ""}
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
                  checkAvailability={checkAgentSlug}
                  onAvailabilityChange={setAvailability}
                  formatPreview={(resourceSlug) => `agt_${organizationSlug}_${resourceSlug}`}
                  disabled={saving}
                />
              )}

            <Field>
              <FieldLabel htmlFor="agent-system-prompt">System prompt</FieldLabel>
              <Textarea
                id="agent-system-prompt"
                value={systemPrompt}
                required
                maxLength={32_768}
                rows={12}
                disabled={saving}
                onChange={(event) => setSystemPrompt(event.target.value)}
              />
              <FieldDescription>
                Default instructions for this agent. An SDK systemPrompt overrides them when
                supplied.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="agent-sandbox-provider">Sandbox provider</FieldLabel>
              <Select
                items={sandboxProviderItems}
                value={sandboxProviderId}
                onValueChange={(value) => setSandboxProviderId(value ?? "")}
                disabled={saving}
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
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!valid || saving || availability === "checking"}
          >
            {saving ? "Saving…" : existing ? "Save changes" : "Create agent"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}

function OrganizationAgentsPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8" aria-busy="true">
      <Skeleton className="h-9 w-40" />
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-52 rounded-xl" />
        <Skeleton className="h-52 rounded-xl" />
      </div>
    </div>
  )
}

async function copyAgentPublicId(publicId: string): Promise<void> {
  try {
    await globalThis.navigator.clipboard.writeText(publicId)
    toast.add({ title: "Agent ID copied", type: "success" })
  } catch {
    toast.add({ title: "The agent ID could not be copied", type: "error" })
  }
}

function agentRequestFailedToast(): void {
  toast.add({ title: "The agent request failed. Try again.", type: "error" })
}
