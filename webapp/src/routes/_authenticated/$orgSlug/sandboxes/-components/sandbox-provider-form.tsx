"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { toast } from "@/components/ui/toast"
import type { OrganizationSandboxProvider } from "@/db/organization-sandbox-provider.server"
import { sandboxProviderDescriptors } from "@/lib/sandbox/registry"
import {
  decodeProviderOptions,
  type SandboxProviderId,
  type SandboxProviderOptions,
} from "@/lib/sandbox/schemas"
import { saveSandboxProvider } from "../-functions/save-sandbox-provider"
import { SANDBOX_PROVIDER_OPTION_DEFAULTS } from "../-lib/constants"
import { sandboxRequestFailedToast } from "../-lib/utils"
import { SandboxProviderOptionFields } from "./sandbox-provider-option-fields"
import { SandboxTextField } from "./sandbox-text-field"

const SANDBOX_PROVIDER_NAME_MAX_LENGTH = 100

export type SandboxProviderFormProps = {
  organizationSlug: string
  /** Null on the create page; carries decrypted credentials for masked editing otherwise. */
  provider: OrganizationSandboxProvider | null
  readOnly: boolean
}

function existingSecret(provider: OrganizationSandboxProvider | null): string {
  if (!provider) return ""
  if ("apiKey" in provider.credentials) return provider.credentials.apiKey
  if ("token" in provider.credentials) return provider.credentials.token
  return ""
}

export function SandboxProviderForm({
  organizationSlug,
  provider: existing,
  readOnly,
}: SandboxProviderFormProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const initialProviderType = existing?.providerType ?? "daytona"
  const initialSecret = existingSecret(existing)
  const [name, setName] = useState(existing?.name ?? "")
  const [providerType, setProviderType] = useState<SandboxProviderId>(initialProviderType)
  const [options, setOptions] = useState<SandboxProviderOptions[SandboxProviderId]>(
    existing?.options ?? SANDBOX_PROVIDER_OPTION_DEFAULTS[initialProviderType],
  )
  const [secret, setSecret] = useState(initialSecret)
  const [secretVisible, setSecretVisible] = useState(false)
  const [saving, setSaving] = useState(false)

  // Base UI resolves the trigger's label from `items`, not from the rendered options.
  const providerItems = sandboxProviderDescriptors.map((item) => ({
    label: item.label,
    value: item.id,
  }))
  const descriptor = sandboxProviderDescriptors.find((item) => item.id === providerType)!
  const credentialLabel = descriptor.credentialLabel ?? "Credential"
  const credentialRequired = providerType !== "docker" && secret.trim() === ""
  const configurationValid = (() => {
    try {
      decodeProviderOptions(providerType, options)
      return name.trim().length > 0 && name === name.trim() &&
        name.length <= SANDBOX_PROVIDER_NAME_MAX_LENGTH
    } catch {
      return false
    }
  })()
  const requiresConnectionTest = !existing || existing.providerType !== providerType ||
    JSON.stringify(existing.options) !== JSON.stringify(options) || secret.trim() !== initialSecret
  const disabled = saving || readOnly

  const save = async () => {
    setSaving(true)
    try {
      const normalizedSecret = secret.trim()
      const result = await saveSandboxProvider({
        data: {
          organizationSlug,
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
      if (existing) {
        await router.invalidate()
        return
      }
      await navigate({
        to: "/$orgSlug/sandboxes/$sandboxProviderId",
        params: { orgSlug: organizationSlug, sandboxProviderId: result.id },
        replace: true,
      })
    } catch {
      sandboxRequestFailedToast()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>{existing ? "Configuration" : "New sandbox provider"}</CardTitle>
        <CardDescription>
          Give each configuration a unique name so workflows can select it explicitly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <SandboxTextField
            id="sandbox-provider-name"
            label="Name"
            value={name}
            maximumLength={SANDBOX_PROVIDER_NAME_MAX_LENGTH}
            disabled={disabled}
            onChange={setName}
          />
          <Field>
            <FieldLabel htmlFor="sandbox-provider-type">Provider</FieldLabel>
            <Select
              items={providerItems}
              value={providerType}
              onValueChange={(value) => {
                const nextProviderType = value as SandboxProviderId
                setProviderType(nextProviderType)
                setOptions(SANDBOX_PROVIDER_OPTION_DEFAULTS[nextProviderType])
                setSecret(nextProviderType === initialProviderType ? initialSecret : "")
                setSecretVisible(false)
              }}
            >
              <SelectTrigger id="sandbox-provider-type" className="w-full" disabled={disabled}>
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

          <SandboxProviderOptionFields
            provider={providerType}
            options={options}
            disabled={disabled}
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
                  disabled={disabled}
                  placeholder={`Enter the ${credentialLabel.toLowerCase()}`}
                  onChange={(event) => setSecret(event.target.value)}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={`${secretVisible ? "Hide" : "Show"} ${credentialLabel}`}
                    title={`${secretVisible ? "Hide" : "Show"} ${credentialLabel}`}
                    disabled={disabled || !secret}
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
      {!readOnly && (
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
          {requiresConnectionTest && (
            <span className="text-xs text-muted-foreground">
              Connection tests create a real sandbox and may incur vendor charges.
            </span>
          )}
        </CardFooter>
      )}
    </Card>
  )
}
