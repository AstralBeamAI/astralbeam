"use client"

import { DotsThreeIcon, StarIcon, TrashIcon } from "@phosphor-icons/react"
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
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { toast } from "@/components/ui/toast"
import type { Agent } from "@/lib/agents/agents.server"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { deleteAgent } from "../../-functions/delete-agent"
import { setDefaultAgent } from "../../-functions/set-default-agent"

export type AgentActionsProps = {
  organizationSlug: string
  agent: Agent
  isDefault: boolean
  canSetDefault: boolean
  canDelete: boolean
}

export function AgentActions({
  organizationSlug,
  agent,
  isDefault,
  canSetDefault,
  canDelete,
}: AgentActionsProps) {
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const makeDefault = async () => {
    setBusy(true)
    try {
      await setDefaultAgent({ data: { organizationSlug, agentId: agent.id } })
      toast.add({ title: `${agent.name} is now the default agent`, type: "success" })
    } catch (error) {
      toast.add({ title: parseServerFnError(error).message, type: "error" })
    } finally {
      await router.invalidate()
      setBusy(false)
    }
  }

  const removeAgent = async () => {
    setBusy(true)
    try {
      await deleteAgent({
        data: { organizationSlug, agentId: agent.id, lockVersion: agent.lockVersion },
      })
      toast.add({ title: `${agent.name} deleted`, type: "success" })
      await navigate({ to: "/$orgSlug/agents", params: { orgSlug: organizationSlug } })
    } catch (error) {
      setDeleteOpen(false)
      const failure = parseServerFnError(error)
      toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "AgentChanged") await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  if ((!canSetDefault || isDefault) && !canDelete) return null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              disabled={busy}
              aria-label="Agent actions"
              title="Agent actions"
            />
          }
        >
          <DotsThreeIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {canSetDefault && !isDefault && (
            <DropdownMenuItem disabled={busy} onClick={() => void makeDefault()}>
              <StarIcon aria-hidden="true" />
              Set as default
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => setDeleteOpen(true)}
            >
              <TrashIcon aria-hidden="true" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {canDelete && (
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its public agent ID will stop working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={busy}
                onClick={() => void removeAgent()}
              >
                {busy ? "Deleting…" : "Delete agent"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}
