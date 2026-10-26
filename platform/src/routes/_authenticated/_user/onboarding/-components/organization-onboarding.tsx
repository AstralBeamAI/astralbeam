"use client"

import type { Organization } from "better-auth/client"
import { useState } from "react"

import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { useHydrated } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { suggestOrganizationNameFromEmail } from "../-lib/utils"

export type OrganizationOnboardingProps = {
  email: string
  /** Refreshes organization access after an invitation is accepted or rejected. */
  onInvitationAction: () => unknown
  onOrganizationCreated: (organization: Organization) => unknown
}

export function OrganizationOnboarding({
  email,
  onInvitationAction,
  onOrganizationCreated,
}: OrganizationOnboardingProps) {
  const [createOpen, setCreateOpen] = useState(false)
  const hydrated = useHydrated()
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

      <UserInvitations hideEmpty onInvitationAction={onInvitationAction} />

      <div className="flex flex-col items-stretch gap-2 sm:items-start">
        <Button type="button" disabled={!hydrated} onClick={() => setCreateOpen(true)}>
          {hydrated ? "Create a new organization" : "Loading organization setup…"}
        </Button>
        <p className="text-xs text-muted-foreground">
          You will be the organization owner and can add members afterward.
        </p>
      </div>

      <p className="text-sm text-muted-foreground">
        Already part of an organization? Ask its owner to invite{" "}
        <strong className="break-all">{email}</strong>, the email address you use to sign in.
      </p>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOrganizationCreated={onOrganizationCreated}
        {...(suggestedName ? { initialName: suggestedName } : {})}
      />
    </section>
  )
}
