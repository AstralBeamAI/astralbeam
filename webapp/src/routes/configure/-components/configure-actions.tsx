"use client"

import { ArrowSquareOutIcon, CheckIcon, FloppyDiskIcon, SignOutIcon } from "@phosphor-icons/react"
import { useRouter } from "@tanstack/react-router"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { logoutOperator } from "../-functions/logout-operator"

// The page's main actions, rendered above and below the content so they are reachable without
// scrolling past every configuration group.
export function ConfigureActions({
  setupComplete,
  busy = false,
  onSave,
  saveDisabled = false,
  onFinishSetup,
}: {
  setupComplete: boolean
  busy?: boolean
  onSave?: () => void
  saveDisabled?: boolean
  onFinishSetup?: () => void
}) {
  const router = useRouter()
  const [leaving, setLeaving] = useState(false)
  const disabled = busy || leaving

  const endSession = (after: () => void) => {
    setLeaving(true)
    void (async () => {
      try {
        await logoutOperator()
        after()
      } catch {
        toast.add({ title: "The request failed; try again", type: "error" })
      } finally {
        setLeaving(false)
      }
    })()
  }

  const handleSignOut = () => endSession(() => void router.invalidate())

  // Leaving the operator surface ends the session, so load the app from the server rather than
  // navigating on the client with the signed-out /configure loader data still in the router cache.
  const handleGoToApp = () => endSession(() => globalThis.location.assign("/"))

  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSave && (
        <Button type="button" onClick={onSave} disabled={disabled || saveDisabled}>
          {busy ? <Spinner /> : <FloppyDiskIcon aria-hidden="true" />}
          Save
        </Button>
      )}
      {onFinishSetup && (
        <Button type="button" variant="secondary" onClick={onFinishSetup} disabled={disabled}>
          <CheckIcon aria-hidden="true" />
          Finish setup
        </Button>
      )}
      <div className="grow" />
      {/* Before setup completes every other page redirects back here, so leaving is pointless. */}
      {setupComplete && (
        <Button
          type="button"
          variant="outline"
          onClick={handleGoToApp}
          disabled={disabled}
          title="End this operator session and open the app"
        >
          <ArrowSquareOutIcon aria-hidden="true" />
          Go to app
        </Button>
      )}
      <Button
        type="button"
        variant="outline"
        onClick={handleSignOut}
        disabled={disabled}
        title="End this operator session"
      >
        <SignOutIcon aria-hidden="true" />
        Sign out
      </Button>
    </div>
  )
}
