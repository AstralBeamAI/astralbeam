"use client"

import { TrashIcon } from "@phosphor-icons/react"
import { useNavigate, useRouter } from "@tanstack/react-router"
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
import type { OrganizationModelProvider } from "@/lib/model-providers/model-providers.server"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { deleteModelProvider } from "../-functions/delete-model-provider"

export function ModelProviderActions({
  organizationSlug,
  provider,
}: {
  organizationSlug: string
  provider: OrganizationModelProvider
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const removeModelProvider = async () => {
    setBusy(true)
    try {
      await deleteModelProvider({
        data: { organizationSlug, id: provider.id, lockVersion: provider.lockVersion },
      })
      toast.add({ title: "Provider deleted", type: "success" })
      await navigate({ to: "/$orgSlug/models", params: { orgSlug: organizationSlug } })
    } catch (error) {
      toast.add({ title: parseServerFnError(error).message, type: "error" })
      setOpen(false)
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button type="button" variant="outline" disabled={busy} />}>
        <TrashIcon aria-hidden="true" />
        Delete provider
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {provider.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes its settings and encrypted API key. Models assigned to an agent must be
            removed from that agent first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={() => void removeModelProvider()}
          >
            {busy ? "Deleting…" : "Delete provider"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
