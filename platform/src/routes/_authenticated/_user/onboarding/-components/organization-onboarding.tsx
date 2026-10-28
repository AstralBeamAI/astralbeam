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
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
    >
      <div className="space-y-2">
        <h1
          id="organization-onboarding-title"
          className="text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          Join or create an organization
        </h1>
        <p className="text-sm text-muted-foreground">
          Bring your agents, models, and team together in one organization.
        </p>
      </div>

      <UserInvitations hideEmpty onInvitationAction={onInvitationAction} />

      <div className="flex flex-col items-stretch gap-4 border bg-card p-4 sm:items-start sm:p-6">
        <div className="space-y-2">
          <h2 className="text-base font-semibold">Start with your own organization</h2>
          <p className="text-sm text-muted-foreground">
            We’ll create a starter agent. Next, connect a model and set up your app.
          </p>
        </div>
        <Button type="button" disabled={!hydrated} onClick={() => setCreateOpen(true)}>
          {hydrated ? "Create a new organization" : "Loading organization setup…"}
        </Button>
        <p className="text-sm text-muted-foreground">
          You’ll be the owner. Invite teammates whenever you’re ready.
        </p>
      </div>

      <div className="space-y-2 px-4 sm:px-6">
        <h2 className="text-base font-semibold">Joining your team?</h2>
        <p className="text-sm text-muted-foreground">
          Ask an owner to invite you using this email. Pending invitations will appear here.
        </p>
        <p className="break-all text-sm font-medium">{email}</p>
      </div>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOrganizationCreated={onOrganizationCreated}
        {...(suggestedName ? { initialName: suggestedName } : {})}
      />
    </section>
  )
}
