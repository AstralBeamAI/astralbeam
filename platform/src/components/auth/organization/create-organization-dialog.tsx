// Added with: deno task ui add @better-auth-ui/organization
// Local changes: use Phosphor and domain-specific function names, generate an organization slug from the display name, accept an onboarding name suggestion, reject reserved slugs before the availability round trip, hand the created organization to callers, omit unsupported organization model fields while retaining the official create flow, focus the name through the dialog's initialFocus, and reset closed-dialog state during render.

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useCheckSlug, useCreateOrganization } from "@better-auth-ui/react/plugins/organization"
import { BriefcaseIcon as Briefcase } from "@phosphor-icons/react"
import type { Organization } from "better-auth/client"
import { type SyntheticEvent, useCallback, useRef, useState } from "react"
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
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { isReservedOrganizationSlug } from "@/lib/auth/organization-slug"

/** Props for the `CreateOrganizationDialog` component. */
export type CreateOrganizationDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOrganizationCreated?: ((organization: Organization) => unknown) | undefined
  initialName?: string
}

export function CreateOrganizationDialog({
  open,
  onOpenChange,
  onOrganizationCreated,
  initialName,
}: CreateOrganizationDialogProps) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  const [name, setName] = useState(() => initialName?.trim() ?? "")
  const [slugAvailability, setSlugAvailability] = useState<
    "available" | "checking" | "idle" | "invalid" | "unavailable"
  >("idle")
  const [nameError, setNameError] = useState<string>()
  const submissionLocked = useRef(false)
  const nameInputRef = useRef<HTMLInputElement>(null)

  const { mutate: createOrganization, isPending: isCreating } = useCreateOrganization(authClient, {
    onSuccess: (organization) => {
      onOpenChange(false)
      return onOrganizationCreated?.(organization)
    },
    onSettled: () => {
      submissionLocked.current = false
    },
  })
  const { mutateAsync: checkSlug } = useCheckSlug(authClient)
  // The organization hooks reject a reserved slug server-side; this only saves a round trip.
  const checkOrganizationSlug = useCallback(
    async (value: string) =>
      !isReservedOrganizationSlug(value) && (await checkSlug({ slug: value })).status,
    [checkSlug],
  )

  const submitOrganizationCreation = (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (submissionLocked.current) return
    const slug = new FormData(e.currentTarget).get("slug")
    if (typeof slug !== "string") return

    submissionLocked.current = true
    createOrganization({ name, slug })
  }

  const isPending = isCreating

  const [prevOpen, setPrevOpen] = useState(open)
  const [prevInitialName, setPrevInitialName] = useState(initialName)
  if (open !== prevOpen || initialName !== prevInitialName) {
    setPrevOpen(open)
    setPrevInitialName(initialName)
    if (!open) {
      setName(initialName?.trim() ?? "")
      setSlugAvailability("idle")
      setNameError(undefined)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocus={nameInputRef}>
        <form onSubmit={submitOrganizationCreation} className="flex flex-col gap-6">
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
                ref={nameInputRef}
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

            <GeneratedSlugField
              key={String(open)}
              id="create-organization-slug"
              label="Slug"
              sourceValue={name}
              fallback="org"
              checkAvailability={checkOrganizationSlug}
              onAvailabilityChange={setSlugAvailability}
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

            <Button
              type="submit"
              disabled={
                isPending ||
                slugAvailability === "checking" ||
                slugAvailability === "invalid" ||
                slugAvailability === "unavailable"
              }
            >
              {isPending && <Spinner />}

              {organizationLocalization.createOrganization}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
