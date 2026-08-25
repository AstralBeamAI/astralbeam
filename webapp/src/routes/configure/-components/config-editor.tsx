"use client"

import { useState } from "react"

import { toast } from "@/components/ui/toast"
import { completeSetup } from "../-functions/complete-setup"
import { rotateAuthSecret } from "../-functions/rotate-auth-secret"
import { saveConfigValues } from "../-functions/save-config-values"
import type { ConfigureField, ConfigureIssue, FieldDraft } from "../-lib/types"
import { ConfigFieldGroups } from "./config-field-groups"
import { ConfigureActions } from "./configure-actions"
import { SetupStatusAlert } from "./setup-status-alert"

export function ConfigEditor({
  fields,
  issues,
  setupComplete,
  onChanged,
}: {
  fields: ConfigureField[]
  issues: ConfigureIssue[]
  setupComplete: boolean
  onChanged: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const pendingUpdates = fields.flatMap((field) => {
    const draft = drafts[field.key] ?? { kind: "unchanged" }
    if (draft.kind !== "set" || draft.value === (field.value ?? "")) return []
    return [{ key: field.key, value: draft.value === "" ? null : draft.value }]
  })

  const setDraft = (key: string, draft: FieldDraft) =>
    setDrafts((current) => ({ ...current, [key]: draft }))

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    try {
      await action()
    } catch {
      toast.add({ title: "The request failed; try again", type: "error" })
    } finally {
      setBusy(false)
    }
  }

  const handleSave = () =>
    run(async () => {
      const result = await saveConfigValues({ data: { updates: pendingUpdates } })
      setFieldErrors(Object.fromEntries(
        result.fieldErrors.map((issue) => [issue.key, issue.message]),
      ))
      if (result.ok) {
        setDrafts({})
        toast.add({ title: "Configuration saved", type: "success" })
        onChanged()
        return
      }
      // An empty key marks a request-level failure such as an expired operator session, which the
      // per-field errors cannot show; reloading then swaps the editor for the login form.
      const requestError = result.fieldErrors.find((issue) => issue.key === "")
      toast.add({
        title: requestError?.message ?? "Some values could not be saved",
        type: "error",
      })
      if (requestError) onChanged()
    })

  const handleRotate = (key: string) =>
    run(async () => {
      const result = await rotateAuthSecret(
        { data: { key: key as "better_auth_secret" | "chat_auth_secret" } },
      )
      if (result.ok) {
        toast.add({ title: "New secret generated", type: "success" })
        onChanged()
      } else {
        toast.add({ title: result.error ?? "The secret could not be rotated", type: "error" })
      }
    })

  const handleCompleteSetup = () =>
    run(async () => {
      const result = await completeSetup()
      if (result.ok) {
        toast.add({ title: "Setup complete", type: "success" })
      } else {
        toast.add({
          title: result.error ?? result.issues?.[0]?.message ?? "Setup is not complete yet",
          type: "error",
        })
      }
      onChanged()
    })

  const actions = (
    <ConfigureActions
      setupComplete={setupComplete}
      busy={busy}
      onSave={() => void handleSave()}
      saveDisabled={pendingUpdates.length === 0}
      {...(setupComplete ? {} : { onFinishSetup: () => void handleCompleteSetup() })}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      {actions}

      <SetupStatusAlert setupComplete={setupComplete} issues={issues} />

      <ConfigFieldGroups
        fields={fields}
        drafts={drafts}
        fieldErrors={fieldErrors}
        disabled={busy}
        onDraftChange={setDraft}
        onRotate={(key) => void handleRotate(key)}
      />

      {actions}
    </div>
  )
}
