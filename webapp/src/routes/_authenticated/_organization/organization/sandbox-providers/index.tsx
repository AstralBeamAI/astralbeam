import { EyeIcon, EyeSlashIcon, PencilSimpleIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "@/components/ui/toast"
import type { OrganizationSandboxProvider } from "@/db/organization-sandbox-provider.server"
import { APP_NAME } from "@/lib/constants"
import {
  decodeProviderOptions,
  type SandboxProviderId,
  type SandboxProviderOptions,
  type SandboxTestMetadata,
} from "@/lib/sandbox/schemas"
import { sandboxProviderDescriptors } from "@/lib/sandbox/registry"
import { deleteOrganizationSandboxProvider } from "./-functions/delete-organization-sandbox-provider.ts"
import { getOrganizationSandboxState } from "./-functions/get-organization-sandbox-state.ts"
import { saveOrganizationSandboxState } from "./-functions/save-organization-sandbox-state.ts"
import { testOrganizationSandboxConnection } from "./-functions/test-organization-sandbox-connection.ts"

type OrganizationSandboxState = {
  organizationId: string
  sandboxProviders: OrganizationSandboxProvider[]
}

const ORGANIZATION_SANDBOX_PROVIDER_DEFAULTS: SandboxProviderOptions = {
  daytona: { target: "us", snapshot: "daytona-medium" },
  docker: { image: "node:22" },
  sprites: {},
  vercel: { teamId: "", projectId: "", runtime: "node24" },
}

export const Route = createFileRoute(
  "/_authenticated/_organization/organization/sandbox-providers/",
)({
  preload: false,
  gcTime: 0,
  loader: {
    staleReloadMode: "blocking",
    handler: async () => {
      const state = await getOrganizationSandboxState()
      if (!state) {
        redirect({ href: "/", replace: true, throw: true })
        throw new Error("TanStack Router redirect did not throw")
      }
      return state
    },
  },
  component: OrganizationSandboxProvidersPage,
  pendingComponent: OrganizationSandboxProvidersPageSkeleton,
  head: () => ({ meta: [{ title: `Sandbox providers · ${APP_NAME}` }] }),
})

function OrganizationSandboxProvidersPage() {
  const state = Route.useLoaderData()
  const stateKey = `${state.organizationId}:${
    state.sandboxProviders.map((provider) => `${provider.id}:${provider.lockVersion}`).join(",")
  }`
  return <OrganizationSandboxProviders key={stateKey} state={state} />
}

function OrganizationSandboxProviders({ state }: { state: OrganizationSandboxState }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(
    state.sandboxProviders.length === 0 ? "new" : null,
  )
  const [busyId, setBusyId] = useState<string | null>(null)
  const controlsDisabled = busyId !== null || editingId !== null
  const editing = editingId === "new"
    ? null
    : state.sandboxProviders.find((provider) => provider.id === editingId) ?? null

  const test = async (provider: OrganizationSandboxProvider) => {
    setBusyId(provider.id)
    try {
      const result = await testOrganizationSandboxConnection({
        data: { id: provider.id, lockVersion: provider.lockVersion },
      })
      toast.add({
        title: result.ok ? "Provider connection succeeded" : result.message,
        type: result.ok ? "success" : "error",
      })
      await router.invalidate()
    } catch {
      sandboxRequestFailedToast()
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (provider: OrganizationSandboxProvider) => {
    setBusyId(provider.id)
    try {
      const result = await deleteOrganizationSandboxProvider({
        data: { id: provider.id, lockVersion: provider.lockVersion },
      })
      toast.add({
        title: result.ok ? `${provider.name} deleted` : result.message,
        type: result.ok ? "success" : "error",
      })
      await router.invalidate()
    } catch {
      sandboxRequestFailedToast()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Sandbox providers
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure named sandbox providers for this organization. Credentials are encrypted and
            visible only to organization owners and developers.
          </p>
        </div>
        <Button disabled={controlsDisabled} onClick={() => setEditingId("new")}>
          <PlusIcon />
          Add provider
        </Button>
      </div>

      {state.sandboxProviders.length > 0 && (
        <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
          {state.sandboxProviders.map((provider) => {
            const descriptor = sandboxProviderDescriptors.find((item) =>
              item.id === provider.providerType
            )!
            return (
              <Card key={provider.id}>
                <CardHeader>
                  <div className="space-y-1">
                    <CardTitle>{provider.name}</CardTitle>
                    <CardDescription>{descriptor.label}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  {provider.lastTest
                    ? <ConnectionStatus metadata={provider.lastTest} />
                    : <p className="text-sm text-muted-foreground">Not tested yet</p>}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={controlsDisabled}
                    onClick={() => setEditingId(provider.id)}
                  >
                    <PencilSimpleIcon />
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    disabled={controlsDisabled}
                    onClick={() => void test(provider)}
                  >
                    {busyId === provider.id ? "Testing…" : "Test connection"}
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger
                      render={
                        <Button
                          variant="outline"
                          disabled={controlsDisabled}
                          aria-label={`Delete ${provider.name}`}
                        />
                      }
                    >
                      <TrashIcon />
                      Delete
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete {provider.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes its settings and encrypted credentials.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => void remove(provider)}
                        >
                          Delete provider
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

      {editingId !== null && (
        <OrganizationSandboxProviderForm
          key={editingId}
          provider={editing}
          onCancel={() => setEditingId(null)}
        />
      )}
    </div>
  )
}

function OrganizationSandboxProviderForm({ provider: existing, onCancel }: {
  provider: OrganizationSandboxProvider | null
  onCancel: () => void
}) {
  const router = useRouter()
  const initialProviderType = existing?.providerType ?? "daytona"
  const [name, setName] = useState(existing?.name ?? "")
  const [providerType, setProviderType] = useState<SandboxProviderId>(initialProviderType)
  const [options, setOptions] = useState<SandboxProviderOptions[SandboxProviderId]>(
    existing?.options ?? ORGANIZATION_SANDBOX_PROVIDER_DEFAULTS[initialProviderType],
  )
  const initialSecret = existing && "apiKey" in existing.credentials
    ? existing.credentials.apiKey
    : existing && "token" in existing.credentials
    ? existing.credentials.token
    : ""
  const [secret, setSecret] = useState(initialSecret)
  const [secretVisible, setSecretVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const descriptor = sandboxProviderDescriptors.find((item) => item.id === providerType)!
  const credentialLabel = descriptor.credentialLabel ?? "Credential"
  const credentialRequired = providerType !== "docker" && secret.trim() === ""
  const configurationValid = (() => {
    try {
      decodeProviderOptions(providerType, options)
      return name.trim().length > 0 && name === name.trim() && name.length <= 100
    } catch {
      return false
    }
  })()
  const requiresConnectionTest = !existing || existing.providerType !== providerType ||
    JSON.stringify(existing.options) !== JSON.stringify(options) || secret.trim() !== initialSecret

  const save = async () => {
    setSaving(true)
    try {
      const normalizedSecret = secret.trim()
      const result = await saveOrganizationSandboxState({
        data: {
          name,
          providerType,
          options,
          credentials: providerType === "docker"
            ? {}
            : providerType === "vercel"
            ? { token: normalizedSecret }
            : { apiKey: normalizedSecret },
          id: existing?.id ?? null,
          lockVersion: existing?.lockVersion ?? null,
        },
      })
      if (!result.ok) {
        toast.add({ title: result.message, type: "error" })
        if (result.code === "stale") await router.invalidate()
        return
      }
      toast.add({
        title: requiresConnectionTest ? "Provider tested and saved" : "Provider saved",
        type: "success",
      })
      await router.invalidate()
    } catch {
      sandboxRequestFailedToast()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{existing ? `Edit ${existing.name}` : "Add sandbox provider"}</CardTitle>
        <CardDescription>
          Give each configuration a unique name so workflows can select it explicitly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <TextField
            id="sandbox-provider-name"
            label="Name"
            value={name}
            maximumLength={100}
            disabled={saving}
            onChange={setName}
          />
          <Field>
            <FieldLabel htmlFor="sandbox-provider-type">Provider</FieldLabel>
            <Select
              value={providerType}
              onValueChange={(value) => {
                const nextProviderType = value as SandboxProviderId
                setProviderType(nextProviderType)
                setOptions(ORGANIZATION_SANDBOX_PROVIDER_DEFAULTS[nextProviderType])
                setSecret(
                  nextProviderType === initialProviderType ? initialSecret : "",
                )
                setSecretVisible(false)
              }}
            >
              <SelectTrigger id="sandbox-provider-type" className="w-full" disabled={saving}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sandboxProviderDescriptors.map((item) => (
                  <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              <a href={descriptor.setupUrl} target="_blank" rel="noreferrer">
                Provider setup guide
              </a>
            </FieldDescription>
          </Field>

          <ProviderFields
            provider={providerType}
            options={options}
            disabled={saving}
            onChange={(patch) =>
              setOptions({ ...options, ...patch } as SandboxProviderOptions[SandboxProviderId])}
          />

          {!configurationValid && (
            <Alert variant="destructive">
              <AlertTitle>Check the provider settings</AlertTitle>
              <AlertDescription>
                Enter a unique name and complete every provider field.
              </AlertDescription>
            </Alert>
          )}

          {providerType !== "docker" && (
            <Field>
              <FieldLabel htmlFor="sandbox-credential">{credentialLabel}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="sandbox-credential"
                  type={secretVisible ? "text" : "password"}
                  autoComplete="new-password"
                  maxLength={16_384}
                  value={secret}
                  disabled={saving}
                  placeholder={`Enter the ${credentialLabel.toLowerCase()}`}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`${secretVisible ? "Hide" : "Show"} ${credentialLabel}`}
                    title={`${secretVisible ? "Hide" : "Show"} ${credentialLabel}`}
                    disabled={saving || !secret}
                    onClick={() => setSecretVisible((visible) => !visible)}
                  >
                    {secretVisible
                      ? <EyeSlashIcon aria-hidden="true" />
                      : <EyeIcon aria-hidden="true" />}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              {existing && existing.providerType !== providerType && (
                <FieldDescription>
                  Changing providers requires new credentials; the previous credentials will be
                  removed.
                </FieldDescription>
              )}
            </Field>
          )}
        </FieldGroup>
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button
          disabled={saving || credentialRequired || !configurationValid}
          onClick={() => void save()}
        >
          {saving
            ? requiresConnectionTest ? "Testing and saving…" : "Saving…"
            : requiresConnectionTest
            ? "Test and save"
            : "Save"}
        </Button>
        <Button variant="outline" disabled={saving} onClick={onCancel}>Cancel</Button>
        {requiresConnectionTest && (
          <span className="text-xs text-muted-foreground">
            Connection tests create a real sandbox and may incur vendor charges.
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

function OrganizationSandboxProvidersPageSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <div className="space-y-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-full max-w-xl" />
      </div>
      <div className="grid max-w-4xl gap-4 sm:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  )
}

function ConnectionStatus({ metadata }: { metadata: SandboxTestMetadata }) {
  const testedAt = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(metadata.testedAt))
  return (
    <Alert variant={metadata.status === "success" ? "default" : "destructive"}>
      <AlertTitle>Connection {metadata.status === "success" ? "verified" : "failed"}</AlertTitle>
      <AlertDescription>
        Last tested <time dateTime={metadata.testedAt}>{testedAt}</time>
        {metadata.errorCode ? ` · ${metadata.errorCode.replaceAll("_", " ")}` : ""}
      </AlertDescription>
    </Alert>
  )
}

function ProviderFields({ provider, options, disabled, onChange }: {
  provider: SandboxProviderId
  options: SandboxProviderOptions[SandboxProviderId]
  disabled: boolean
  onChange: (patch: Record<string, unknown>) => void
}) {
  if (provider === "docker") {
    const value = options as SandboxProviderOptions["docker"]
    return (
      <TextField
        id="docker-image"
        label="Image"
        value={value.image}
        maximumLength={256}
        disabled={disabled}
        onChange={(image) => onChange({ image })}
      />
    )
  }
  if (provider === "daytona") {
    const value = options as SandboxProviderOptions["daytona"]
    return (
      <>
        <Field>
          <FieldLabel htmlFor="daytona-target">Target</FieldLabel>
          <Select
            value={value.target}
            onValueChange={(target) => onChange({ target })}
            disabled={disabled}
          >
            <SelectTrigger id="daytona-target">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="us">US</SelectItem>
              <SelectItem value="eu">EU</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <TextField
          id="daytona-snapshot"
          label="Snapshot"
          value={value.snapshot}
          maximumLength={256}
          disabled={disabled}
          onChange={(snapshot) => onChange({ snapshot })}
        />
      </>
    )
  }
  if (provider === "sprites") return null
  if (provider !== "vercel") return provider satisfies never
  const value = options as SandboxProviderOptions["vercel"]
  return (
    <>
      <TextField
        id="vercel-team-id"
        label="Team ID"
        value={value.teamId}
        maximumLength={256}
        disabled={disabled}
        onChange={(teamId) => onChange({ teamId })}
      />
      <TextField
        id="vercel-project-id"
        label="Project ID"
        value={value.projectId}
        maximumLength={256}
        disabled={disabled}
        onChange={(projectId) => onChange({ projectId })}
      />
      <Field>
        <FieldLabel htmlFor="vercel-runtime">Runtime</FieldLabel>
        <Select
          value={value.runtime}
          onValueChange={(runtime) => onChange({ runtime })}
          disabled={disabled}
        >
          <SelectTrigger id="vercel-runtime">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="node24">Node.js 24</SelectItem>
            <SelectItem value="node22">Node.js 22</SelectItem>
            <SelectItem value="python3.13">Python 3.13</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </>
  )
}

function TextField({ id, label, value, maximumLength, disabled, onChange }: {
  id: string
  label: string
  value: string
  maximumLength: number
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        maxLength={maximumLength}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}

function sandboxRequestFailedToast() {
  toast.add({
    title: "The request could not be completed",
    description: "Refresh and try again. Sensitive changes may require you to sign in again.",
    type: "error",
  })
}
