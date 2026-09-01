// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Use Phosphor icons; generate immutable key slugs; require a fresh session; surface the public key ID; promptly evict the one-time secret from the mutation cache.

"use client"

import {
  type ApiKeyAuthClient,
  apiKeyExpirationDaysToSeconds,
} from "@better-auth-ui/core/plugins/api-key"
import { getAuthLinkURL, getSafeRedirectTo, isSessionNotFreshError } from "@better-auth-ui/core"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useCreateApiKey } from "@better-auth-ui/react/plugins/api-key"
import { KeyIcon } from "@phosphor-icons/react"
import { type SyntheticEvent, useState } from "react"
import { GeneratedSlugField } from "@/components/generated-slug-field"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"
import { formatOrganizationApiKeyPrefix } from "@/lib/auth/organization-api-key-configuration"
import { isValidSlug } from "@/lib/slug"
import { checkOrganizationApiKeySlugAvailability } from "@/routes/_authenticated/_organization/organization/api-keys/-functions/check-organization-api-key-slug-availability"
import { NewApiKeyDialog } from "./new-api-key-dialog"

export type CreateApiKeyDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Create an organization-owned key by passing the organization id. */
  organizationId?: string | undefined
  organizationSlug: string
}

function checkApiKeySlug(value: string) {
  return checkOrganizationApiKeySlugAvailability({ data: value })
}

export function CreateApiKeyDialog({
  open,
  onOpenChange,
  organizationId,
  organizationSlug,
}: CreateApiKeyDialogProps) {
  const { authClient, basePaths, localization, navigate, viewPaths } = useAuth<ApiKeyAuthClient>()
  const {
    configurations,
    keyExpiration,
    localization: apiKeyLocalization,
  } = useAuthPlugin(apiKeyPlugin)

  const {
    mutate: createApiKey,
    error: createApiKeyError,
    isPending: isCreating,
    reset: resetCreateApiKey,
  } = useCreateApiKey(authClient, { gcTime: 0 })

  const [isNewKeyDialogOpen, setIsNewKeyDialogOpen] = useState(false)
  const [keyName, setKeyName] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [slugAvailability, setSlugAvailability] = useState<
    "available" | "checking" | "idle" | "invalid" | "unavailable"
  >("idle")
  const [nameError, setNameError] = useState<string>()
  const [secretKey, setSecretKey] = useState<string | null>(null)
  const [publicKeyId, setPublicKeyId] = useState<string | null>(null)
  const availableConfigurations = configurations.filter(
    (configuration) => configuration.organization === Boolean(organizationId),
  )
  const expirationItems = keyExpiration
    ? [
      ...keyExpiration.intervals.map((days) => ({
        label: `${days.toLocaleString()} ${
          days === 1 ? apiKeyLocalization.day : apiKeyLocalization.days
        }`,
        value: String(days),
      })),
      ...(keyExpiration.allowNever ? [{ label: apiKeyLocalization.never, value: "never" }] : []),
    ]
    : []
  const needsFreshSession = isSessionNotFreshError(createApiKeyError)

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetCreateApiKey()
      setKeyName(null)
      setName("")
      setSlugAvailability("idle")
      setNameError(undefined)
      setSecretKey(null)
      setPublicKeyId(null)
    }

    onOpenChange(nextOpen)
  }

  const handleNewKeyDialogOpenChange = (nextOpen: boolean) => {
    setIsNewKeyDialogOpen(nextOpen)

    if (!nextOpen) {
      setKeyName(null)
      setNameError(undefined)
      setSecretKey(null)
      setPublicKeyId(null)
    }
  }

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()

    const formData = new FormData(e.target as HTMLFormElement)
    const normalizedName = name.trim()
    if (!normalizedName) {
      setNameError(localization.auth.fieldRequired)
      return
    }
    const slug = formData.get("slug")
    if (typeof slug !== "string" || !isValidSlug(slug)) return
    setNameError(undefined)

    const expiration = formData.get("expiration")
    const expirationDays = typeof expiration === "string" && expiration !== "never"
      ? Number(expiration)
      : undefined
    const expiresIn = expirationDays ? apiKeyExpirationDaysToSeconds(expirationDays) : undefined

    const configIdValue = formData.get("configId")
    const configId = typeof configIdValue === "string" ? configIdValue.trim() : ""
    const payload = {
      name: normalizedName,
      prefix: formatOrganizationApiKeyPrefix(slug),
      ...(expiresIn ? { expiresIn } : {}),
      ...(configId ? { configId } : {}),
      ...(organizationId ? { organizationId } : {}),
    }

    createApiKey(payload, {
      onSuccess: (result) => {
        handleOpenChange(false)
        setKeyName(normalizedName)
        setSecretKey(result.key)
        setPublicKeyId(`key_${organizationSlug}_${slug}`)
        setIsNewKeyDialogOpen(true)
      },
    })
  }

  function signInAgainForApiKey() {
    const returnPath = getSafeRedirectTo(
      `${globalThis.location.pathname}${globalThis.location.search}`,
      globalThis.location.origin,
    )
    const link = new URL(
      getAuthLinkURL(`${basePaths.auth}/${viewPaths.auth.signIn}`, returnPath),
      globalThis.location.origin,
    )
    link.searchParams.set("fresh", "true")
    navigate({ to: `${link.pathname}${link.search}` })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          {needsFreshSession && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {localization.settings.freshSessionTitle}
                </DialogTitle>
                <DialogDescription>
                  {localization.settings.freshSessionDescription}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button type="button" onClick={signInAgainForApiKey}>
                  {localization.settings.freshSessionSignIn}
                </Button>
              </DialogFooter>
            </>
          )}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-6"
            hidden={needsFreshSession}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyIcon aria-hidden="true" />
                {apiKeyLocalization.createApiKey}
              </DialogTitle>

              <DialogDescription>
                {apiKeyLocalization.apiKeysDescription}
              </DialogDescription>
            </DialogHeader>

            <FieldGroup>
              <Field data-invalid={!!nameError}>
                <FieldLabel htmlFor="api-key-name">
                  {apiKeyLocalization.name}
                </FieldLabel>

                <Input
                  id="api-key-name"
                  name="name"
                  required
                  maxLength={32}
                  placeholder={apiKeyLocalization.name}
                  disabled={isCreating}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setNameError(undefined)
                  }}
                  onInvalid={(e) => {
                    e.preventDefault()
                    setNameError(localization.auth.fieldRequired)
                  }}
                  aria-invalid={!!nameError}
                />

                <FieldError>{nameError}</FieldError>
              </Field>

              <GeneratedSlugField
                key={String(open)}
                id="api-key-identifier"
                label="Identifier"
                sourceValue={name}
                fallback="key"
                checkAvailability={checkApiKeySlug}
                onAvailabilityChange={setSlugAvailability}
                formatPreview={(resourceSlug) => `key_${organizationSlug}_${resourceSlug}`}
                disabled={isCreating}
              />

              {availableConfigurations.length > 0 && (
                <Field>
                  <FieldLabel htmlFor="api-key-configuration">
                    {apiKeyLocalization.configuration}
                  </FieldLabel>
                  <Select
                    items={availableConfigurations.map((configuration) => ({
                      label: configuration.label,
                      value: configuration.id,
                    }))}
                    name="configId"
                    defaultValue={availableConfigurations[0]?.id}
                    disabled={isCreating}
                  >
                    <SelectTrigger
                      id="api-key-configuration"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {availableConfigurations.map((configuration) => (
                          <SelectItem
                            key={configuration.id}
                            value={configuration.id}
                          >
                            {configuration.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {keyExpiration
                ? (
                  <Field>
                    <FieldLabel htmlFor="api-key-expiration">
                      {apiKeyLocalization.expiration}
                    </FieldLabel>

                    <Select
                      items={expirationItems}
                      name="expiration"
                      defaultValue={keyExpiration.defaultInterval === null
                        ? "never"
                        : String(keyExpiration.defaultInterval)}
                      disabled={isCreating}
                    >
                      <SelectTrigger id="api-key-expiration" className="w-full">
                        <SelectValue />
                      </SelectTrigger>

                      <SelectContent>
                        <SelectGroup>
                          {expirationItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                )
                : null}
            </FieldGroup>

            <DialogFooter>
              <DialogClose
                className={buttonVariants({ variant: "outline" })}
                disabled={isCreating}
                type="button"
              >
                {localization.settings.cancel}
              </DialogClose>

              <Button
                type="submit"
                disabled={isCreating || slugAvailability === "checking" ||
                  slugAvailability === "invalid" || slugAvailability === "unavailable"}
              >
                {isCreating && <Spinner />}

                {apiKeyLocalization.createApiKey}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <NewApiKeyDialog
        open={isNewKeyDialogOpen}
        onOpenChange={handleNewKeyDialogOpenChange}
        secretKey={secretKey}
        publicKeyId={publicKeyId}
        name={keyName}
      />
    </>
  )
}
