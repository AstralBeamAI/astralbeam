"use client"

import { Option, Schema } from "effect"
import { useState } from "react"

import { toast } from "@/components/ui/toast"
import {
  EMAIL_PROVIDER_SETTING_KEYS,
  EmailProviderConnectionInputSchema,
  EmailProviderSchema,
} from "@/emails/schema"
import type { ConfigIssue, ConfigKey } from "@/lib/types"
import { generateConfigValue } from "../-functions/generate-config-value"
import { revealConfigValue } from "../-functions/reveal-config-value"
import { saveConfigValues } from "../-functions/save-config-values"
import { testEmailProviderConnection } from "../-functions/test-email-provider-connection"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldGroups } from "./config-field-groups"
import { ConfigureActions } from "./configure-actions"
import { SetupStatusAlert } from "./setup-status-alert"

const decodeEmailProvider = Schema.decodeUnknownSync(EmailProviderSchema)
const decodeEmailProviderConnectionInput = Schema.decodeUnknownOption(
  EmailProviderConnectionInputSchema,
)
const emailConfigKeys = new Set([
  "email_provider",
  ...Object.values(EMAIL_PROVIDER_SETTING_KEYS).flat(),
])

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
  // Secrets arrive as `null`, so a value an operator revealed is the only copy the page holds.
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [emailProviderTesting, setEmailProviderTesting] = useState(false)
  const [emailProviderTestResult, setEmailProviderTestResult] = useState<
    { ok: boolean; message: string } | undefined
  >()
  const hasMissingGeneratedValue = fields.some((field) =>
    field.source === "database" && field.required && field.canGenerate && !field.isSet
  )

  const storedValue = (field: ConfigureField) => revealedValues[field.key] ?? field.value

  const pendingUpdates = fields.flatMap<{ key: string; value: string | null }>((field) => {
    const draft = drafts[field.key] ?? { kind: "unchanged" }
    const stored = storedValue(field)
    if (field.source === "environment") return []
    if (draft.kind === "unchanged") {
      // Re-saving a value stored under a fallback key re-encrypts it with the active one. A
      // secret has to be revealed or replaced first, which is what its field message asks for.
      return field.storageStatus === "fallback-key" && stored !== null
        ? [{ key: field.key, value: stored }]
        : []
    }
    if (draft.kind === "clear") return [{ key: field.key, value: null }]
    if (draft.value === (stored ?? "")) return []
    if (!field.required && draft.value === "") {
      return [{ key: field.key, value: null }]
    }
    return [{ key: field.key, value: draft.value }]
  })

  const setDraft = (key: string, draft: FieldDraft) => {
    if (emailConfigKeys.has(key)) setEmailProviderTestResult(undefined)
    setDrafts((current) => ({ ...current, [key]: draft }))
  }

  const currentValue = (key: ConfigKey, clearedValue = "") => {
    const field = fields.find((candidate) => candidate.key === key)
    const draft = drafts[key] ?? { kind: "unchanged" }
    if (draft.kind === "set") return draft.value || clearedValue
    if (draft.kind === "clear") return clearedValue
    return (field && storedValue(field)) ?? clearedValue
  }

  const emailProvider = decodeEmailProvider(currentValue("email_provider", "smtp"))
  const settings = Object.fromEntries(
    EMAIL_PROVIDER_SETTING_KEYS[emailProvider].map((key) => [
      key,
      currentValue(key) || undefined,
    ]),
  )
  const emailProviderConnectionInput = decodeEmailProviderConnectionInput({
    provider: emailProvider,
    settings,
  })
  const canTestEmailProvider = Option.isSome(emailProviderConnectionInput)

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
      setRevealedValues({})
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
        // The stored value changed, so any copy this page revealed is stale.
        setRevealedValues({})
        toast.add({ title: "New secret generated", type: "success" })
        onChanged()
      } else {
        toast.add({ title: result.error ?? "The secret could not be generated", type: "error" })
      }
    })

  const handleReveal = async (key: ConfigKey): Promise<boolean> => {
    try {
      const result = await revealConfigValue({ data: { key } })
      if (result.ok) {
        setRevealedValues((current) => ({ ...current, [key]: result.value ?? "" }))
        return true
      }
      toast.add({ title: result.error, type: "error" })
    } catch {
      toast.add({ title: "The value could not be revealed; try again", type: "error" })
    }
    return false
  }

  const handleTestEmailProvider = () =>
    run(async () => {
      if (Option.isNone(emailProviderConnectionInput)) return
      setEmailProviderTesting(true)
      setEmailProviderTestResult(undefined)
      try {
        const result = await testEmailProviderConnection({
          data: emailProviderConnectionInput.value,
        })
        setEmailProviderTestResult(
          result.ok
            ? {
              ok: true,
              message: emailProvider === "smtp"
                ? "DNS, SMTP, the selected security mode, and authentication passed. No email was sent."
                : emailProvider === "resend"
                ? "The Resend API accepted the configured API key. No email was sent."
                : "Amazon SES accepted the configured region and credentials, and account sending is enabled. No email was sent.",
            }
            : { ok: false, message: result.error },
        )
      } finally {
        setEmailProviderTesting(false)
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
        revealedValues={revealedValues}
        fieldErrors={fieldErrors}
        disabled={busy}
        onDraftChange={setDraft}
        onGenerate={(key) => void handleGenerate(key)}
        onReveal={handleReveal}
        onTestEmailProvider={() => void handleTestEmailProvider()}
        emailProvider={emailProvider}
        canTestEmailProvider={canTestEmailProvider}
        emailProviderTesting={emailProviderTesting}
        emailProviderTestResult={emailProviderTestResult}
      />

      {actions}
    </div>
  )
}
