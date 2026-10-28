// Added from @better-auth-ui/organization
// Local changes: use Phosphor icons and standard browser globals, render comma-joined static roles correctly, and provide a semantic page heading. Use TanStack hydration readiness. Improve onboarding copy, layout, and form guidance. Distinguish unavailable invitations, account mismatches, and load failures with recovery actions.

import { getSafeRedirectTo } from "@better-auth-ui/core"
import {
  memberRoleLabels,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthenticate, useAuthPlugin } from "@better-auth-ui/react"
import {
  useAcceptInvitation,
  useInvitation,
  useRejectInvitation,
} from "@better-auth-ui/react/plugins/organization"
import type { Invitation } from "better-auth/client"
import { Predicate } from "effect"
import {
  BriefcaseIcon as BriefcaseBusiness,
  CheckIcon as Check,
  XIcon as X,
} from "@phosphor-icons/react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { cn } from "cn"
import { useHydrated } from "@tanstack/react-router"

type UserInvitation = Invitation & { organizationName?: string }

export type AcceptInvitationProps = {
  className?: string
}

function isPendingInvitation(invitation: UserInvitation | undefined) {
  if (invitation?.status !== "pending") return false

  return new Date(invitation.expiresAt).getTime() > Date.now()
}

function getInvitationRecovery({
  error,
  unavailableTitle,
  returnLabel,
}: {
  error: unknown
  unavailableTitle: string
  returnLabel: string
}) {
  if (
    Predicate.hasProperty(error, "error") &&
    Predicate.hasProperty(error.error, "code") &&
    error.error.code === "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION"
  ) {
    return {
      title: "Use your invited account",
      description:
        "This invitation was sent to a different email address. Sign in with the email that received it to join the organization.",
      label: "Sign in with another account",
      action: "sign-in",
    }
  }
  if (error && !(Predicate.hasProperty(error, "status") && error.status === 400)) {
    return {
      title: "Couldn’t load invitation",
      description: "We couldn’t check this invitation. Try again in a moment.",
      label: "Try again",
      action: "retry",
    }
  }
  return {
    title: unavailableTitle,
    description:
      "This invitation has expired or is no longer available. Ask an owner to send a new invitation to your sign-in email.",
    label: returnLabel,
    action: "return",
  }
}

/**
 * Render the organization invitation addressed by the `invitationId` query
 * parameter and let the signed-in recipient accept or reject it directly.
 */
export function AcceptInvitation({ className }: AcceptInvitationProps) {
  const { authClient, basePaths, navigate, redirectTo, viewPaths } = useAuth()
  const { localization, roles } = useAuthPlugin(organizationPlugin)
  const organizationAuthClient = authClient as OrganizationAuthClient
  const isHydrated = useHydrated()
  const invitationId = isHydrated
    ? new URLSearchParams(globalThis.location.search).get("invitationId")
    : null
  const session = useAuthenticate(organizationAuthClient)
  const invitationQuery = useInvitation(organizationAuthClient, {
    query: { id: invitationId ?? "" },
    enabled: Boolean(invitationId),
    meta: { errorPresentation: "inline" },
  })
  const invitation = invitationQuery.data as UserInvitation | undefined

  const returnToApplication = () => {
    navigate({
      to: getSafeRedirectTo(redirectTo, globalThis.location.origin),
      replace: true,
    })
  }

  const { mutate: acceptInvitation, isPending: isAccepting } = useAcceptInvitation(
    organizationAuthClient,
    {
      onSuccess: returnToApplication,
    },
  )
  const { mutate: rejectInvitation, isPending: isRejecting } = useRejectInvitation(
    organizationAuthClient,
    {
      onSuccess: returnToApplication,
    },
  )
  const isLoading =
    !isHydrated ||
    session.isPending ||
    !session.data ||
    (Boolean(invitationId) && invitationQuery.isPending)
  const isAvailable = isPendingInvitation(invitation)
  const recovery = getInvitationRecovery({
    error: invitationQuery.error,
    unavailableTitle: localization.invitationUnavailable,
    returnLabel: localization.return,
  })
  const recoverInvitation = () => {
    if (recovery.action === "sign-in") {
      const search = new URLSearchParams({
        redirectTo: `${globalThis.location.pathname}${globalThis.location.search}`,
      })
      navigate({ to: `${basePaths.auth}/${viewPaths.auth.signOut}?${search}` })
    } else if (recovery.action === "retry") {
      void invitationQuery.refetch()
    } else {
      returnToApplication()
    }
  }
  const organizationName = invitation?.organizationName || localization.organization
  const role = invitation
    ? memberRoleLabels(invitation.role, roles).join(", ")
    : localization.member

  return (
    <Card className={cn("w-full max-w-sm", className)}>
      <CardHeader className="gap-3">
        <div className="flex size-10 items-center justify-center rounded-md bg-muted">
          <BriefcaseBusiness className="size-5" />
        </div>

        <CardTitle className="text-xl font-semibold">
          {isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <h1 className="wrap-anywhere">
              {isAvailable ? `Join ${organizationName}` : recovery.title}
            </h1>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : isAvailable ? (
          <>
            <FieldDescription className="wrap-anywhere">
              {localization.acceptInvitationDescription
                .replace("{{organization}}", organizationName)
                .replace("{{role}}", role)}
            </FieldDescription>

            <div className="flex items-center gap-3 rounded-md bg-muted p-3">
              <div className="min-w-0 flex-1 truncate text-sm font-medium">{organizationName}</div>
              <Badge variant="secondary">{role}</Badge>
            </div>
          </>
        ) : (
          <FieldDescription className="wrap-anywhere">{recovery.description}</FieldDescription>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          {isLoading ? (
            <>
              <Skeleton className="h-9 flex-1" />
              <Skeleton className="h-9 flex-1" />
            </>
          ) : isAvailable && invitation ? (
            <>
              <Button
                className="flex-1"
                type="button"
                variant="outline"
                disabled={isAccepting || isRejecting}
                onClick={() => rejectInvitation({ invitationId: invitation.id })}
              >
                {isRejecting ? <Spinner /> : <X />}
                {localization.rejectInvitation}
              </Button>

              <Button
                className="flex-1"
                type="button"
                disabled={isAccepting || isRejecting}
                onClick={() => acceptInvitation({ invitationId: invitation.id })}
              >
                {isAccepting ? <Spinner /> : <Check />}
                Join organization
              </Button>
            </>
          ) : (
            <Button
              className="w-full sm:col-span-2"
              type="button"
              disabled={invitationQuery.isFetching}
              aria-busy={invitationQuery.isFetching}
              onClick={recoverInvitation}
            >
              {recovery.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
