"use client"

import { InfoIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { suggestOrganizationNameFromEmail } from "../-lib/utils"

export type OrganizationOnboardingProps = {
  email: string
  /** Refreshes organization access after creation or an invitation action. */
  onOrganizationAccessChange?: () => unknown | Promise<unknown>
}

export function OrganizationOnboarding({
  email,
  onOrganizationAccessChange,
}: OrganizationOnboardingProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const suggestedName = suggestOrganizationNameFromEmail(email)

  return (
    <section
      aria-labelledby="organization-onboarding-title"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12"
    >
      <div className="space-y-2">
        <h1
          id="organization-onboarding-title"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Join or create an organization
        </h1>
        <p className="text-sm text-muted-foreground sm:text-base">
          Accept a pending invitation or create a new organization to continue.
        </p>
      </div>

      <UserInvitations
        {...onOrganizationAccessChange ? { onInvitationAction: onOrganizationAccessChange } : {}}
      />

      <Alert>
        <InfoIcon aria-hidden="true" />
        <AlertTitle>Don&apos;t see your organization?</AlertTitle>
        <AlertDescription>
          Ask its owner to invite{" "}
          <strong className="break-all">{email}</strong>, the exact email address you use with email
          and password, Google, or GitHub.
        </AlertDescription>
      </Alert>

      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        <Button type="button" onClick={() => setCreateOpen(true)}>
          Create a new organization
        </Button>
        <p className="text-xs text-muted-foreground">
          You will be the organization owner and can add members afterward.
        </p>
      </div>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        {...onOrganizationAccessChange ? { onOrganizationCreated: onOrganizationAccessChange } : {}}
        {...(suggestedName ? { initialName: suggestedName } : {})}
      />
    </section>
  )
}
