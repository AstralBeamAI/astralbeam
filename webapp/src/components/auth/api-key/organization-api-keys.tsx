// Added with: deno task ui add @better-auth-ui/api-key
// Local changes: Allow direct route use and support exact optional property types.

"use client"

import {
  hasMemberRole,
  type OrganizationAuthClient,
} from "@better-auth-ui/core/plugins/organization"
import { useAuth, useAuthPlugin } from "@better-auth-ui/react"
import { useActiveMemberRole, useHasPermission } from "@better-auth-ui/react/plugins/organization"
import type { ReactNode } from "react"
import { organizationPlugin } from "@/lib/auth/organization-plugin"
import { ApiKeys } from "./api-keys"

export type OrganizationApiKeysProps = {
  children?: ReactNode
  className?: string | undefined
  organizationId: string
  organizationSlug: string
  unauthorized?: ReactNode
}

/**
 * {@link ApiKeys} scoped to an explicit organization.
 *
 * Access is resolved per API-key action. The configured organization creator
 * role receives Better Auth's creator override.
 */
export function OrganizationApiKeys({
  children,
  className,
  organizationId,
  organizationSlug,
  unauthorized,
}: OrganizationApiKeysProps) {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { creatorRole } = useAuthPlugin(organizationPlugin)
  const memberRole = useActiveMemberRole(authClient, {
    query: { organizationId },
  })
  const isCreator = hasMemberRole(memberRole.data?.role, creatorRole)
  const permissionOptions = {
    enabled: !memberRole.isPending && !isCreator,
    organizationId,
  }
  const canRead = useHasPermission(authClient, {
    ...permissionOptions,
    permissions: { apiKey: ["read"] } as Parameters<
      OrganizationAuthClient["organization"]["hasPermission"]
    >[0]["permissions"],
  })
  const canCreate = useHasPermission(authClient, {
    ...permissionOptions,
    permissions: { apiKey: ["create"] } as Parameters<
      OrganizationAuthClient["organization"]["hasPermission"]
    >[0]["permissions"],
  })
  const canUpdate = useHasPermission(authClient, {
    ...permissionOptions,
    permissions: { apiKey: ["update"] } as Parameters<
      OrganizationAuthClient["organization"]["hasPermission"]
    >[0]["permissions"],
  })
  const canDelete = useHasPermission(authClient, {
    ...permissionOptions,
    permissions: { apiKey: ["delete"] } as Parameters<
      OrganizationAuthClient["organization"]["hasPermission"]
    >[0]["permissions"],
  })
  const permissionPending = !isCreator &&
    !memberRole.isPending &&
    (canRead.isPending ||
      canCreate.isPending ||
      canUpdate.isPending ||
      canDelete.isPending)
  const isPending = memberRole.isPending || permissionPending
  const canReadKeys = isCreator || canRead.data?.success

  if (isPending) {
    return (
      <>
        {children}
        <ApiKeys
          className={className}
          hideCreate
          hideDelete
          hideUpdate
          isPending
          organizationId={organizationId}
          organizationSlug={organizationSlug}
        />
      </>
    )
  }
  if (!canReadKeys) return unauthorized ?? null

  return (
    <>
      {children}
      <ApiKeys
        className={className}
        hideCreate={!isCreator && !canCreate.data?.success}
        hideDelete={!isCreator && !canDelete.data?.success}
        hideUpdate={!isCreator && !canUpdate.data?.success}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
      />
    </>
  )
}
