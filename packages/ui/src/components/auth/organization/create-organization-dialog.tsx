// shadcn command: `vp run @astralbeam/ui#ui add @better-auth-ui/organization`
// Local edits: Uses Phosphor icons, accepts a typed organization client, normalizes bounded organization identifiers, resets on close, and notifies consumers after creation.

"use client"

import {
  type OrganizationAuthClient,
  useAuth,
  useAuthPlugin,
  useCreateOrganization,
} from "@better-auth-ui/react"
import { BriefcaseIcon } from "@phosphor-icons/react"
import { type ChangeEvent, type InvalidEvent, type SyntheticEvent, useState } from "react"

import { Button, buttonVariants } from "@/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/dialog"
import { Field, FieldError, FieldLabel } from "@/components/field"
import { Input } from "@/components/input"
import { Spinner } from "@/components/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import {
  ORGANIZATION_NAME_MAX_LENGTH,
  sanitizeOrganizationSlug,
} from "@/lib/auth/organization-slug"
import { SlugField } from "./slug-field"

export type CreateOrganizationDialogProps = {
  authClient: OrganizationAuthClient
  onOpenChange: (open: boolean) => void
  onSuccess: (() => void | Promise<void>) | undefined
  open: boolean
}

export function CreateOrganizationDialog({
  authClient,
  onOpenChange,
  onSuccess,
  open,
}: CreateOrganizationDialogProps) {
  const { localization } = useAuth()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)
  const [name, setName] = useState("")
  const [editedSlug, setEditedSlug] = useState<string>()
  const [nameError, setNameError] = useState<string>()
  const slug = editedSlug ?? sanitizeOrganizationSlug(name)

  function resetForm() {
    setEditedSlug(undefined)
    setName("")
    setNameError(undefined)
  }

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen)
    if (!nextOpen) resetForm()
  }

  const { mutate: createOrganization, isPending: isCreating } = useCreateOrganization(authClient, {
    onSuccess: async () => {
      handleOpenChange(false)
      await onSuccess?.()
    },
  })

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedName = name.trim()

    if (!normalizedName) {
      setNameError(localization.auth.fieldRequired)
      return
    }

    createOrganization({ name: normalizedName, slug })
  }

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    setName(event.target.value)
    setNameError(undefined)
  }

  function handleNameInvalid(event: InvalidEvent<HTMLInputElement>) {
    event.preventDefault()
    setNameError(localization.auth.fieldRequired)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <form className="flex flex-col gap-6" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              <BriefcaseIcon />
              {organizationLocalization.createOrganization}
            </DialogTitle>
            <DialogDescription>
              {organizationLocalization.organizationsDescription}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <Field data-invalid={!!nameError}>
              <FieldLabel htmlFor="create-organization-name">
                {organizationLocalization.name}
              </FieldLabel>
              <Input
                aria-invalid={!!nameError}
                disabled={isCreating}
                id="create-organization-name"
                maxLength={ORGANIZATION_NAME_MAX_LENGTH}
                name="name"
                onChange={handleNameChange}
                onInvalid={handleNameInvalid}
                placeholder={organizationLocalization.namePlaceholder}
                required
                value={name}
              />
              <FieldError>{nameError}</FieldError>
            </Field>

            <SlugField
              authClient={authClient}
              disabled={isCreating}
              id="create-organization-slug"
              onChange={setEditedSlug}
              value={slug}
            />
          </div>

          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isCreating}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>
            <Button disabled={isCreating} type="submit">
              {isCreating && <Spinner />}
              {organizationLocalization.createOrganization}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
