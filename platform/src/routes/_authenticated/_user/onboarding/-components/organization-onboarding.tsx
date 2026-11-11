"use client"

import type { Organization } from "better-auth/client"

import { CreateOrganizationForm } from "@/components/auth/organization/create-organization-dialog"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { suggestOrganizationNameFromEmail } from "../-lib/utils"

export type OrganizationOnboardingProps = {
  email: string
  hasInvitations: boolean
  /** Refreshes organization access after an invitation is accepted or rejected. */
  onInvitationAction: () => unknown
  onOrganizationCreated: (organization: Organization) => unknown
}

export function OrganizationOnboarding({
  email,
  hasInvitations,
  onInvitationAction,
  onOrganizationCreated,
}: OrganizationOnboardingProps) {
  const suggestedName = suggestOrganizationNameFromEmail(email)

  return (
    <section
      aria-labelledby="organization-onboarding-title"
      className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-12"
    >
      <div className="space-y-2">
        <h1
          id="organization-onboarding-title"
          className="font-sans text-xl font-semibold tracking-tight"
        >
          {hasInvitations ? "Join your team" : "Create your organization"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {hasInvitations
            ? "Accept an invitation below, or create an organization of your own."
            : "Bring your agents, models, and team together in one place."}
        </p>
      </div>

      <UserInvitations
        hideEmpty
        className="[&_h2]:font-sans"
        onInvitationAction={onInvitationAction}
      />

      <CreateOrganizationForm
        onOrganizationCreated={onOrganizationCreated}
        {...(suggestedName ? { initialName: suggestedName } : {})}
        header={
          hasInvitations && (
            <h2 className="font-sans text-sm font-semibold">Create your own organization</h2>
          )
        }
      />

      {!hasInvitations && (
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Joining an existing team? Ask an owner to invite{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      )}
    </section>
  )
}
