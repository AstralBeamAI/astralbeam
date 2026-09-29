"use client"

import { EyeIcon, EyeSlashIcon } from "@phosphor-icons/react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useState } from "react"
import { Equal, Result, Schema, SchemaIssue } from "effect"

import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { strictParseOptions } from "@/lib/schemas"
import { SaveSandboxProviderInputSchema } from "../-lib/schemas"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
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
import type { OrganizationSandboxProvider } from "@/lib/sandboxes/providers.server"
import { sandboxProviderDescriptors } from "@/lib/sandboxes/registry"
import { type SandboxProviderId, type SandboxProviderOptions } from "@/lib/sandboxes/schemas"
import { saveSandboxProvider } from "../-functions/save-sandbox-provider"
import { SANDBOX_PROVIDER_OPTION_DEFAULTS } from "../-lib/constants"
import { SandboxProviderOptionFields } from "./sandbox-provider-option-fields"
import { SandboxTextField } from "./sandbox-text-field"

const SANDBOX_PROVIDER_NAME_MAX_LENGTH = 100
const formatSandboxIssues = SchemaIssue.makeFormatterStandardSchemaV1()

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
  const [nameError, setNameError] = useState<string | null>(null)

  // Base UI resolves the trigger's label from `items`, not from the rendered options.
  const providerItems = sandboxProviderDescriptors.map((item) => ({
    label: item.label,
    value: item.id,
  }))
  const descriptor = sandboxProviderDescriptors.find((item) => item.id === providerType)!
  const credentialLabel = descriptor.credentialLabel ?? "Credential"
  const input = Schema.decodeUnknownResult(
    SaveSandboxProviderInputSchema,
    strictParseOptions,
  )({
    organizationSlug,
    name,
    providerType,
    options,
    credentials:
      providerType === "docker"
        ? {}
        : providerType === "vercel"
          ? { token: secret.trim() }
          : { apiKey: secret.trim() },
    id: existing?.id ?? null,
    lockVersion: existing?.lockVersion ?? null,
  })
  const issues = Result.isFailure(input) ? formatSandboxIssues(input.failure.issue).issues : []
  const sandboxFieldErrors = (path: string) =>
    issues.filter(
      (issue) =>
        issue.path
          ?.map((segment) => (typeof segment === "object" ? segment.key : segment))
          .join(".") === path,
    )
  const credentialErrors = sandboxFieldErrors(
    providerType === "vercel" ? "credentials.token" : "credentials.apiKey",
  )
  const requiresConnectionTest =
    !existing ||
    existing.providerType !== providerType ||
    !Equal.equals(existing.options, options) ||
    secret.trim() !== initialSecret
  const disabled = saving || readOnly

  const save = async () => {
    if (Result.isFailure(input)) return
    setSaving(true)
    setNameError(null)
    try {
      const sandboxProviderId = await saveSandboxProvider({ data: input.success })
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
        params: { orgSlug: organizationSlug, sandboxProviderId },
        replace: true,
      })
    } catch (error) {
      const failure = parseServerFnError(error)
      if (failure.tag === "SandboxProviderNameTaken") {
        setNameError(failure.message)
        return
      }
      toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "SandboxProviderChanged") await router.invalidate()
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
            onChange={(value) => {
              setName(value)
              setNameError(null)
            }}
            errors={[...sandboxFieldErrors("name"), ...(nameError ? [{ message: nameError }] : [])]}
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
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
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
            errorsFor={(key) => sandboxFieldErrors(`options.${key}`)}
            disabled={disabled}
            onChange={(patch) =>
              setOptions({ ...options, ...patch } as SandboxProviderOptions[SandboxProviderId])
            }
          />

          {providerType !== "docker" && (
            <Field data-invalid={credentialErrors.length > 0 || undefined}>
              <FieldLabel htmlFor="sandbox-credential">{credentialLabel}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id="sandbox-credential"
                  aria-invalid={credentialErrors.length > 0 || undefined}
                  aria-describedby={
                    credentialErrors.length > 0 ? "sandbox-credential-error" : undefined
                  }
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
                    {secretVisible ? (
                      <EyeSlashIcon aria-hidden="true" />
                    ) : (
                      <EyeIcon aria-hidden="true" />
                    )}
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError id="sandbox-credential-error" errors={credentialErrors} />
              {existing && existing.providerType !== providerType && (
                <FieldDescription>
                  Changing providers requires new credentials; the previous credentials will be
                  removed.
                </FieldDescription>
              )}
              {existing &&
                !existing.credentialsReadable &&
                existing.providerType === providerType && (
                  <FieldDescription>
                    The stored credentials cannot be read. Enter them again, then test and save.
                  </FieldDescription>
                )}
            </Field>
          )}
        </FieldGroup>
      </CardContent>
      {!readOnly && (
        <CardFooter className="flex flex-wrap gap-2">
          <Button disabled={saving || Result.isFailure(input)} onClick={() => void save()}>
            {saving
              ? requiresConnectionTest
                ? "Testing and saving…"
                : "Saving…"
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
