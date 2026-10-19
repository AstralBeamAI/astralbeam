"use client"

import { TrashIcon } from "@phosphor-icons/react"
import { useNavigate, useRouter } from "@tanstack/react-router"
import { useInvalidateOrganizationPages } from "@/routes/_authenticated/$orgSlug/-lib/page-query"
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
import { toast } from "@/components/ui/toast"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import type { UsageLimit } from "@/lib/usage-limits/usage-limits.server"
import { deleteUsageLimit } from "../../-functions/delete-usage-limit"

export function UsageLimitActions({
  organizationSlug,
  usageLimit,
}: {
  organizationSlug: string
  usageLimit: UsageLimit
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const invalidatePages = useInvalidateOrganizationPages()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const removeUsageLimit = async () => {
    setBusy(true)
    try {
      await deleteUsageLimit({
        data: {
          organizationSlug,
          usageLimitId: usageLimit.id,
          lockVersion: usageLimit.lockVersion,
        },
      })
      toast.add({ title: `${usageLimit.name} deleted`, type: "success" })
      await invalidatePages()
      await navigate({ to: "/$orgSlug/usage-limits", params: { orgSlug: organizationSlug } })
    } catch (error) {
      setOpen(false)
      const failure = parseServerFnError(error)
      toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "UsageLimitChanged") await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            disabled={busy}
            aria-label={`Delete ${usageLimit.name}`}
          />
        }
      >
        <TrashIcon aria-hidden="true" />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {usageLimit.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            It stops applying immediately, including to tokens that list its ID, and its usage
            counts are discarded.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => void removeUsageLimit()}
          >
            {busy ? "Deleting…" : "Delete limit"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
