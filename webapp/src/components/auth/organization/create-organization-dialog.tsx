// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor, accept an onboarding name suggestion, and omit unsupported organization model fields while retaining the official create flow.

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useCreateOrganization } from "@better-auth-ui/react/plugins/organization"
import { BriefcaseIcon as Briefcase } from "@phosphor-icons/react"
import { type SyntheticEvent, useEffect, useRef, useState } from "react"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { sanitizeSlug, SlugField } from "./slug-field"

/** Props for the `CreateOrganizationDialog` component. */
export type CreateOrganizationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialName?: string
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  initialName,
}: CreateOrganizationDialogProps) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  const [name, setName] = useState(() => initialName?.trim() ?? "")
  const [slug, setSlug] = useState("")
  const [slugEdited, setSlugEdited] = useState(false)
  const [nameError, setNameError] = useState<string>()
  const submissionLocked = useRef(false)

  const { mutate: createOrganization, isPending: isCreating } = useCreateOrganization(authClient, {
    onSuccess: () => onOpenChange(false),
    onSettled: () => {
      submissionLocked.current = false
    },
  })

  const handleSubmit = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submissionLocked.current) return

    submissionLocked.current = true
    createOrganization({ name, slug })
  }

  const isPending = isCreating

  useEffect(() => {
    if (!open) {
      setSlug("")
      setName(initialName?.trim() ?? "")
      setSlugEdited(false)
      setNameError(undefined)
    }
  }, [initialName, open])

  useEffect(() => {
    if (slugEdited) return
    setSlug(sanitizeSlug(name))
  }, [name, slugEdited])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase />
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
                id="create-organization-name"
                name="name"
                autoFocus
                required
                placeholder={organizationLocalization.namePlaceholder}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(undefined)
                }}
                onInvalid={(e) => {
                  e.preventDefault()
                  setNameError(localization.auth.fieldRequired)
                }}
                aria-invalid={!!nameError}
                disabled={isPending}
              />

              <FieldError>{nameError}</FieldError>
            </Field>

            <SlugField
              id="create-organization-slug"
              value={slug}
              onChange={(value) => {
                setSlug(value)
                setSlugEdited(true)
              }}
              disabled={isPending}
            />
          </div>

          <DialogFooter>
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isPending}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>

            <Button type="submit" disabled={isPending}>
              {isPending && <Spinner />}

              {organizationLocalization.createOrganization}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
