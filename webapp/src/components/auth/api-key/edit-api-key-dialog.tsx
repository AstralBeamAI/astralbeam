// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Show the immutable public API key ID and surface a sanitized inline rename error because this mutation intentionally bypasses the shared toaster.

"use client"

import type { ApiKeyAuthClient } from "@better-auth-ui/core/plugins/api-key"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useUpdateApiKey } from "@better-auth-ui/react/plugins/api-key"
import { type FormEvent, useState } from "react"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { apiKeyPlugin } from "@/lib/auth/api-key-plugin"
import type { OrganizationApiKey } from "@/lib/auth/organization-api-key-configuration"

export function EditApiKeyDialog({
  apiKey,
  open,
  onOpenChange,
  publicId,
}: {
  apiKey: OrganizationApiKey
  open: boolean
  onOpenChange: (open: boolean) => void
  publicId: string
}) {
  const { authClient, localization } = useAuth<ApiKeyAuthClient>()
  const { localization: labels } = useAuthPlugin(apiKeyPlugin)
  const [nameError, setNameError] = useState<string>()

  const updateApiKey = useUpdateApiKey(authClient, {
    onSuccess: () => onOpenChange(false),
    onError: () => setNameError("The API key could not be renamed. Try again."),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nameValue = formData.get("name")
    const name = typeof nameValue === "string" ? nameValue.trim() : ""
    if (!name) {
      setNameError(localization.auth.fieldRequired)
      return
    }
    setNameError(undefined)
    updateApiKey.mutate({
      keyId: apiKey.id,
      name,
    })
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setNameError(undefined)
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{labels.editApiKey}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`api-key-public-id-${apiKey.id}`}>ID</FieldLabel>
              <Input
                id={`api-key-public-id-${apiKey.id}`}
                value={publicId}
                readOnly
                className="font-mono text-xs"
              />
            </Field>
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor={`api-key-name-${apiKey.id}`}>
                {labels.name}
              </FieldLabel>
              <Input
                key={new Date(apiKey.updatedAt).getTime()}
                id={`api-key-name-${apiKey.id}`}
                name="name"
                defaultValue={apiKey.name ?? ""}
                required
                maxLength={32}
                disabled={updateApiKey.isPending}
                onChange={() => setNameError(undefined)}
                onInvalid={(event) => {
                  event.preventDefault()
                  setNameError(localization.auth.fieldRequired)
                }}
                aria-invalid={!!nameError}
              />
              <FieldError>{nameError}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={updateApiKey.isPending}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>
            <Button disabled={updateApiKey.isPending} type="submit">
              {updateApiKey.isPending && <Spinner />}
              {localization.settings.saveChanges}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
