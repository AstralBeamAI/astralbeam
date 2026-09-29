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
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import type { OrganizationSandboxProvider } from "@/lib/sandboxes/providers.server"
import { deleteSandboxProvider } from "../../-functions/delete-sandbox-provider"
import { testSandboxProviderConnection } from "../../-functions/test-sandbox-provider-connection"

export type SandboxProviderActionsProps = {
  organizationSlug: string
  provider: OrganizationSandboxProvider
  canTest: boolean
  canDelete: boolean
}

export function SandboxProviderActions({
  organizationSlug,
  provider,
  canTest,
  canDelete,
}: SandboxProviderActionsProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const showFailure = async (error: unknown) => {
    const failure = parseServerFnError(error)
    toast.add({ title: failure.message, type: "error" })
    if (failure.tag === "SandboxProviderChanged" || failure.tag === "SandboxProviderInUse") {
      await router.invalidate()
    }
  }

  const testConnection = async () => {
    setBusy(true)
    try {
      const result = await testSandboxProviderConnection({
        data: { organizationSlug, id: provider.id, lockVersion: provider.lockVersion },
      })
      const succeeded = result.status === "success"
      toast.add({
        title: succeeded ? "Provider connection succeeded" : "The provider connection test failed",
        type: succeeded ? "success" : "error",
      })
      await router.invalidate()
    } catch (error) {
      await showFailure(error)
    } finally {
      setBusy(false)
    }
  }

  const removeProvider = async () => {
    setBusy(true)
    try {
      await deleteSandboxProvider({
        data: { organizationSlug, id: provider.id, lockVersion: provider.lockVersion },
      })
      toast.add({ title: `${provider.name} deleted`, type: "success" })
      await navigate({ to: "/$orgSlug/sandboxes", params: { orgSlug: organizationSlug } })
    } catch (error) {
      await showFailure(error)
    } finally {
      setBusy(false)
    }
  }

  if (!canTest && !canDelete) return null

  return (
    <div className="flex flex-wrap gap-2">
      {canTest && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => void testConnection()}
        >
          {busy ? "Testing…" : "Test connection"}
        </Button>
      )}
      {canDelete && (
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                aria-label={`Delete ${provider.name}`}
              />
            }
          >
            <TrashIcon aria-hidden="true" />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {provider.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes its settings and encrypted credentials.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void removeProvider()}>
                Delete provider
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
