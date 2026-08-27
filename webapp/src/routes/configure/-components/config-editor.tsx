"use client"

import { useState } from "react"

import { toast } from "@/components/ui/toast"
import type { ConfigIssue, ConfigKey } from "@/lib/types"
import { generateConfigValue } from "../-functions/generate-config-value"
import { saveConfigValues } from "../-functions/save-config-values"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldGroups } from "./config-field-groups"
import { ConfigureActions } from "./configure-actions"
import { SetupStatusAlert } from "./setup-status-alert"

export function ConfigEditor({
  fields,
  issues,
  setupComplete,
  fallbackEncryptionKeyCount,
  onChanged,
}: {
  fields: ConfigureField[]
  issues: ConfigIssue[]
  setupComplete: boolean
  fallbackEncryptionKeyCount: number
  onChanged: () => void
}) {
  const [drafts, setDrafts] = useState<Record<string, FieldDraft>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const hasMissingGeneratedValue = fields.some((field) =>
    field.source === "database" && field.required && field.canGenerate && !field.isSet
  )

  const pendingUpdates = fields.flatMap<{ key: string; value: string | null }>((field) => {
    const draft = drafts[field.key] ?? { kind: "unchanged" }
    if (field.source === "environment") return []
    if (draft.kind === "unchanged") {
      return field.storageStatus === "fallback-key" && field.value !== null
        ? [{ key: field.key, value: field.value }]
        : []
    }
    if (draft.kind === "clear") return [{ key: field.key, value: null }]
    if (draft.value === (field.value ?? "")) return []
    if (!field.required && draft.value === "") {
      return [{ key: field.key, value: null }]
    }
    return [{ key: field.key, value: draft.value }]
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

  const savePendingUpdates = async () => {
    const result = await saveConfigValues({ data: { updates: pendingUpdates } })
    if (result.ok) {
      setFieldErrors({})
      setDrafts({})
      return true
    }
    setFieldErrors(Object.fromEntries(
      result.fieldErrors.map((issue) => [issue.key, issue.message]),
    ))
    toast.add({
      title: result.error ?? "Some values could not be saved",
      type: "error",
    })
    if (result.error) onChanged()
    return false
  }

  const handleSave = () =>
    run(async () => {
      if (!await savePendingUpdates()) return
      toast.add({ title: "Configuration saved", type: "success" })
      onChanged()
    })

  const handleGenerate = (key: ConfigKey) =>
    run(async () => {
      const result = await generateConfigValue({ data: { key } })
      if (result.ok) {
        toast.add({ title: "New secret generated", type: "success" })
        onChanged()
      } else {
        toast.add({ title: result.error ?? "The secret could not be generated", type: "error" })
      }
    })

  const actions = (
    <ConfigureActions
      setupComplete={setupComplete}
      busy={busy}
      onSave={() => void handleSave()}
      saveDisabled={pendingUpdates.length === 0 && !hasMissingGeneratedValue}
    />
  )

  return (
    <div className="flex flex-col gap-6">
      {actions}

      <SetupStatusAlert
        setupComplete={setupComplete}
        issues={issues}
        fallbackEncryptionKeyCount={fallbackEncryptionKeyCount}
      />

      <ConfigFieldGroups
        fields={fields}
        drafts={drafts}
        fieldErrors={fieldErrors}
        disabled={busy}
        onDraftChange={setDraft}
        onGenerate={(key) => void handleGenerate(key)}
      />

      {actions}
    </div>
  )
}
