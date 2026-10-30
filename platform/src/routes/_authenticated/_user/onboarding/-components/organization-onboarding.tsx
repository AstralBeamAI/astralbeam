"use client"

import type { Organization } from "better-auth/client"
import { useState } from "react"

import { CreateOrganizationDialog } from "@/components/auth/organization/create-organization-dialog"
import { UserInvitations } from "@/components/auth/organization/user-invitations"
import { useHydrated } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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

      <Card>
        <CardContent className="flex flex-col items-stretch gap-4 sm:items-start">
          <div className="space-y-2">
            {hasInvitations && (
              <h2 className="font-sans text-sm font-semibold">Create your own organization</h2>
            )}
            <p className="text-sm text-muted-foreground">
              We’ll create your first agent. Connect a model, then add the agent to your app.
            </p>
          </div>
          <Button
            className="text-sm"
            type="button"
            disabled={!hydrated}
            onClick={() => setCreateOpen(true)}
          >
            Create organization
          </Button>
          <p className="text-sm text-muted-foreground">
            You’ll be the owner and can invite teammates anytime.
          </p>
        </CardContent>
      </Card>

      {!hasInvitations && (
        <p className="text-sm text-muted-foreground wrap-anywhere">
          Joining an existing team? Ask an owner to invite{" "}
          <span className="font-medium text-foreground">{email}</span>.
        </p>
      )}

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onOrganizationCreated={onOrganizationCreated}
        {...(suggestedName ? { initialName: suggestedName } : {})}
      />
    </section>
  )
}
