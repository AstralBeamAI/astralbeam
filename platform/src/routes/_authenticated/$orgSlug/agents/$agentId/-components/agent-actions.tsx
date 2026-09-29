"use client"

import { StarIcon, TrashIcon } from "@phosphor-icons/react"
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
      const failure = parseServerFnError(error)
      toast.add({ title: failure.message, type: "error" })
      if (failure.tag === "AgentChanged") await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  if (!canSetDefault && !canDelete) return null

  return (
    <div className="flex flex-wrap gap-2">
      {canSetDefault && !isDefault && (
        <Button type="button" variant="outline" disabled={busy} onClick={() => void makeDefault()}>
          <StarIcon aria-hidden="true" />
          Set as default
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
                aria-label={`Delete ${agent.name}`}
              />
            }
          >
            <TrashIcon aria-hidden="true" />
            Delete
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {agent.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Its public agent ID will stop working immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => void removeAgent()}>
                Delete agent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  )
}
