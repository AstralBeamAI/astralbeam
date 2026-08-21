import type { OrganizationAuthClient } from "@better-auth-ui/core/plugins/organization"
import { useAuth, useSession } from "@better-auth-ui/react"
import {
  useActiveOrganization,
  useListOrganizationMembers,
} from "@better-auth-ui/react/plugins/organization"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useServerFn } from "@tanstack/react-start"
import type { Member } from "better-auth/client"
import { Clock, Trash as Trash2 } from "@phosphor-icons/react"
import { toast } from "sonner"

import { hasOrganizationRole } from "@/auth/organization-access-control"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  listPendingOrganizationAccess,
  revokePendingOrganizationAccess,
  updatePendingOrganizationAccessRole,
} from "@/server/organization-access.functions"

export function PendingOrganizationAccess() {
  const { authClient } = useAuth<OrganizationAuthClient>()
  const { data: session } = useSession(authClient)
  const { data: organization } = useActiveOrganization(authClient)
  const { data: membersData, isPending: membersPending } = useListOrganizationMembers(authClient)
  const listAccess = useServerFn(listPendingOrganizationAccess)
  const updateRole = useServerFn(updatePendingOrganizationAccessRole)
  const revokeAccess = useServerFn(revokePendingOrganizationAccess)
  const queryClient = useQueryClient()

  const currentMember = membersData?.members.find((candidate: Member) =>
    candidate.userId === session?.user.id
  )
  const isOwner = currentMember ? hasOrganizationRole(currentMember.role, "owner") : false
  const canManage = isOwner ||
    (currentMember ? hasOrganizationRole(currentMember.role, "admin") : false)
  const queryKey = ["organization-access", organization?.id]
  const pendingAccess = useQuery({
    enabled: !!organization && canManage,
    queryFn: () => listAccess(),
    queryKey,
  })

  if (membersPending) {
    return (
      <Card className="flex min-h-28 items-center justify-center">
        <Spinner />
      </Card>
    )
  }
  if (!canManage) return null

  async function changeRole(grantId: string, requestedRole: "member" | "admin") {
    try {
      await updateRole({ data: { grantId, requestedRole } })
      await queryClient.invalidateQueries({ queryKey })
      toast.success("Pending role updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update the pending role")
    }
  }

  async function revoke(grantId: string) {
    try {
      await revokeAccess({ data: { grantId } })
      await queryClient.invalidateQueries({ queryKey })
      toast.success("Pending access revoked")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to revoke pending access")
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold">Pending access</h3>
        <p className="text-sm text-muted-foreground">
          Access activates automatically when the verified matching email signs in and capacity is
          available.
        </p>
      </div>
      <Card className="p-0">
        <Table aria-label="Pending organization access">
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Created by</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-end">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pendingAccess.isPending
              ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={5}>
                    <Spinner />
                  </TableCell>
                </TableRow>
              )
              : pendingAccess.isError
              ? (
                <TableRow>
                  <TableCell className="h-24 text-center" colSpan={5}>
                    <div className="flex flex-col items-center gap-3">
                      <p className="text-sm text-destructive" role="alert">
                        Unable to load pending access.
                      </p>
                      <Button
                        onClick={() => void pendingAccess.refetch()}
                        size="sm"
                        variant="outline"
                      >
                        Try again
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
              : pendingAccess.data?.length
              ? (
                pendingAccess.data.map((grant) => (
                  <TableRow key={grant.id}>
                    <TableCell className="font-medium">{grant.email}</TableCell>
                    <TableCell>
                      <Select
                        disabled={!isOwner && grant.requestedRole === "admin"}
                        items={isOwner
                          ? [{ label: "Member", value: "member" }, {
                            label: "Admin",
                            value: "admin",
                          }]
                          : [{ label: "Member", value: "member" }]}
                        onValueChange={(value) =>
                          void changeRole(grant.id, value === "admin" ? "admin" : "member")}
                        value={grant.requestedRole}
                      >
                        <SelectTrigger className="w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          {isOwner ? <SelectItem value="admin">Admin</SelectItem> : null}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{grant.createdByName}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        <Clock /> {new Date(grant.createdAt).toLocaleDateString()}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        aria-label={`Revoke access for ${grant.email}`}
                        onClick={() => void revoke(grant.id)}
                        size="icon-sm"
                        variant="ghost"
                      >
                        <Trash2 className="text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )
              : (
                <TableRow>
                  <TableCell className="h-24 text-center text-muted-foreground" colSpan={5}>
                    No pending access
                  </TableCell>
                </TableRow>
              )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
