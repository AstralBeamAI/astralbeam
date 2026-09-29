"use client"

import { organizationQueryKeys } from "@better-auth-ui/core/plugins/organization"
import { useSession } from "@better-auth-ui/react"
import { TrashIcon } from "@phosphor-icons/react"
import { useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/toast"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { authClient } from "@/lib/auth/client"
import { requestOrganizationDeletion } from "../-functions/request-organization-deletion"

export type DeleteOrganizationCardProps = {
  organizationId: string
  organizationSlug: string
  organizationName: string
  dogfood: boolean
}

export function DeleteOrganizationCard({
  organizationId,
  organizationSlug,
  organizationName,
  dogfood,
}: DeleteOrganizationCardProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: session } = useSession(authClient)
  const [confirmation, setConfirmation] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [open, setOpen] = useState(false)

  const remove = async () => {
    setDeleting(true)
    try {
      await requestOrganizationDeletion({ data: { organizationSlug, organizationId } })
      await queryClient.invalidateQueries({
        queryKey: organizationQueryKeys.lists(session?.user.id),
      })
      toast.add({ title: `${organizationName} deleted`, type: "success" })
      await navigate({ to: "/", replace: true })
    } catch (error) {
      setOpen(false)
      toast.add({ title: parseServerFnError(error).message, type: "error" })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card className="max-w-2xl border-destructive/40">
      <CardHeader>
        <CardTitle>Delete organization</CardTitle>
        <CardDescription>
          {dogfood
            ? "This deployment's own organization powers the dashboard assistant and cannot be deleted."
            : "Remove every member, API key, agent, sandbox provider, tenant, and tenant user. This cannot be undone."}
        </CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <AlertDialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            setConfirmation("")
          }}
        >
          <AlertDialogTrigger
            render={<Button type="button" variant="destructive" disabled={dogfood} />}
          >
            <TrashIcon aria-hidden="true" />
            Delete organization
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {organizationName}?</AlertDialogTitle>
              <AlertDialogDescription>
                Members lose access and its API keys and SDK tokens stop working immediately. Its
                remaining data is removed in the background.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Field>
              <FieldLabel htmlFor="delete-organization-confirmation">
                Type <span className="font-mono">{organizationSlug}</span> to confirm
              </FieldLabel>
              <Input
                id="delete-organization-confirmation"
                value={confirmation}
                autoComplete="off"
                disabled={deleting}
                onChange={(event) => setConfirmation(event.target.value)}
                className="font-mono text-xs"
              />
            </Field>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={deleting || confirmation.trim() !== organizationSlug}
                onClick={() => void remove()}
              >
                {deleting ? "Deleting…" : "Delete organization"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardFooter>
    </Card>
  )
}
