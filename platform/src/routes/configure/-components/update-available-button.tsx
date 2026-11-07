"use client"

import { ArrowCircleUpIcon } from "@phosphor-icons/react"
import { useEffect, useState } from "react"

import { DocsLink } from "@/components/docs-link"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
import { buttonVariants } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { APP_HANDLE, APP_NAME, APP_RELEASES_REPOSITORY } from "@/lib/constants"
import { parseServerFnError } from "@/lib/runtime/server-fn-error"
import { getAvailableUpdate } from "../-functions/get-available-update"
import { installUpdate } from "../-functions/install-update"

type Update = Awaited<ReturnType<typeof getAvailableUpdate>>

// Reload once the restarted server answers, giving systemd a moment to stop the old one first.
async function reloadAfterRestart() {
  await new Promise((resolve) => setTimeout(resolve, 3000))
  for (let attempt = 0; attempt < 60; attempt++) {
    const response = await fetch("/api/status", { cache: "no-store" }).catch(() => undefined)
    if (response?.ok) break
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  globalThis.location.reload()
}

export function UpdateAvailableButton() {
  const [update, setUpdate] = useState<Update>(null)
  const [serviceName, setServiceName] = useState(`${APP_HANDLE}-platform`)
  const [status, setStatus] = useState<"idle" | "installing" | "done">("idle")
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)

  useEffect(() => {
    // A failed release lookup only hides the button.
    void getAvailableUpdate().then(setUpdate, () => undefined)
  }, [])

  if (!update) return null

  const handleInstall = async () => {
    setStatus("installing")
    setMessage(null)
    try {
      const restart = await installUpdate({ data: { version: update.latestVersion, serviceName } })
      const installed = `Installed ${update.latestVersion} and applied its migrations.`
      if (restart === "restarted") {
        setMessage({ error: false, text: `${installed} Restarting ${serviceName}…` })
        await reloadAfterRestart()
      } else if (restart === "failed") {
        setMessage({
          error: true,
          text: `${installed} Restarting ${serviceName} failed, so run \`sudo systemctl restart ${serviceName}\`.`,
        })
      } else {
        setMessage({ error: false, text: `${installed} Restart the server to finish.` })
      }
      setStatus("done")
    } catch (error) {
      setMessage({ error: true, text: parseServerFnError(error).message })
      setStatus("idle")
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger className={buttonVariants({ size: "sm" })}>
        <ArrowCircleUpIcon aria-hidden="true" />
        Update available
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update {APP_NAME}?</AlertDialogTitle>
          <AlertDialogDescription>
            Current version {update.currentVersion}, new version {update.latestVersion}. This
            installs the{" "}
            <a
              href={`https://github.com/${APP_RELEASES_REPOSITORY}/releases/tag/v${update.latestVersion}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4"
            >
              new release
            </a>
            , runs its database migrations, and restarts the system service if one exists.{" "}
            <DocsLink href="/docs/self-hosting/operations#backups-and-restore">
              Back up first
            </DocsLink>
            .
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="update-service-name">System service</FieldLabel>
          <Input
            id="update-service-name"
            value={serviceName}
            onChange={(event) => setServiceName(event.target.value)}
            disabled={status !== "idle"}
          />
          <FieldDescription>The systemd service restarted after migrating.</FieldDescription>
        </Field>
        {message && (
          <Alert variant={message.error ? "destructive" : "default"}>
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={status === "installing"}>Close</AlertDialogCancel>
          <AlertDialogAction disabled={status !== "idle"} onClick={() => void handleInstall()}>
            {status === "installing" && <Spinner />}
            Install update
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
