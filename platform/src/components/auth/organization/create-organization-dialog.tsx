// Added from @better-auth-ui/organization
// Local changes: use Phosphor and domain-specific function names, generate an organization slug from the display name without a random suffix, explain its URL role, accept an onboarding name suggestion, reject reserved slugs before the availability round trip, hand the created organization to callers, omit unsupported organization model fields while retaining the official create flow, focus the name through the dialog's initialFocus, render a taken slug from the availability check or a create race against the slug field, export the form for inline onboarding and reset it by unmounting the closed dialog, and keep pointer clicks outside the form from dismissing it. Improve onboarding copy, layout, and form guidance.

import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useCheckSlug, useCreateOrganization } from "@better-auth-ui/react/plugins/organization"
import { BriefcaseIcon as Briefcase } from "@phosphor-icons/react"
import { useHydrated } from "@tanstack/react-router"
import type { Organization } from "better-auth/client"
import {
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useRef,
  useState,
} from "react"
import { isOrganizationSlugTakenError } from "@/components/auth/error-toaster"
import { GeneratedSlugField } from "@/components/generated-slug-field"
import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "cn"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { isReservedOrganizationSlug } from "@/lib/organizations/reserved-slugs"

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
  const { localization } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)
  const nameInputRef = useRef<HTMLInputElement>(null)

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
      <DialogContent initialFocus={nameInputRef}>
        <CreateOrganizationForm
          nameInputRef={nameInputRef}
          {...(initialName === undefined ? {} : { initialName })}
          onOrganizationCreated={(organization) => {
            onOpenChange(false)
            return onOrganizationCreated?.(organization)
          }}
          header={
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Briefcase />
                {organizationLocalization.createOrganization}
              </DialogTitle>

              <DialogDescription>
                Give your team’s shared space a name. You can change it later.
              </DialogDescription>
            </DialogHeader>
          }
          cancel={(isPending) => (
            <DialogClose
              className={buttonVariants({ variant: "outline" })}
              disabled={isPending}
              type="button"
            >
              {localization.settings.cancel}
            </DialogClose>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}

/** The organization name and slug form, inside the dialog or inline during onboarding. */
export function CreateOrganizationForm({
  onOrganizationCreated,
  initialName,
  nameInputRef,
  header,
  cancel,
}: {
  onOrganizationCreated: (organization: Organization) => unknown
  initialName?: string
  nameInputRef?: RefObject<HTMLInputElement | null>
  header?: ReactNode
  cancel?: (isPending: boolean) => ReactNode
}) {
  const { authClient, localization } = useAuth<OrganizationAuthClient>()
  const { localization: organizationLocalization } = useAuthPlugin(organizationPlugin)

  const [name, setName] = useState(() => initialName?.trim() ?? "")
  const [slugAvailability, setSlugAvailability] = useState<
    "available" | "checking" | "idle" | "invalid" | "unavailable"
  >("idle")
  const [nameError, setNameError] = useState<string>()
  const [takenSlug, setTakenSlug] = useState<string>()
  const submissionLocked = useRef(false)
  // Inline onboarding renders this form on first paint, before React can intercept submission.
  const hydrated = useHydrated()

  const { mutate: createOrganization, isPending } = useCreateOrganization(authClient, {
    onSuccess: (organization) => onOrganizationCreated(organization),
    onError: (error, { slug }) => {
      if (isOrganizationSlugTakenError(error)) setTakenSlug(slug)
    },
    onSettled: () => {
      submissionLocked.current = false
    },
  })
  const { mutateAsync: checkSlug } = useCheckSlug(authClient)
  // The organization hooks reject a reserved slug server-side; this only saves a round trip.
  const checkOrganizationSlug = useCallback(
    async (value: string) => {
      if (isReservedOrganizationSlug(value)) return false
      try {
        return (await checkSlug({ slug: value })).status
      } catch (error) {
        // Better Auth rejects a taken slug instead of answering `status: false`.
        if (isOrganizationSlugTakenError(error)) return false
        throw error
      }
    },
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

  return (
    <form onSubmit={submitOrganizationCreation} className="flex flex-col gap-6">
      {header}

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
          id="create-organization-slug"
          label="Organization slug"
          sourceValue={name}
          checkAvailability={checkOrganizationSlug}
          unavailableValue={takenSlug}
          onAvailabilityChange={setSlugAvailability}
          disabled={isPending}
        />
      </div>

      <div className={cn("flex flex-col-reverse gap-2 sm:flex-row", cancel && "sm:justify-end")}>
        {cancel?.(isPending)}

        <Button
          type="submit"
          disabled={
            !hydrated ||
            isPending ||
            slugAvailability === "checking" ||
            slugAvailability === "invalid" ||
            slugAvailability === "unavailable"
          }
        >
          {isPending && <Spinner />}

          {organizationLocalization.createOrganization}
        </Button>
      </div>
    </form>
  )
}
