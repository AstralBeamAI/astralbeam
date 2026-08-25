"use client"

import { CheckCircleIcon, GlobeIcon, WarningCircleIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from "@/components/ui/toast"
import { completeSetup } from "../-functions/complete-setup"
import { rotateAuthSecret } from "../-functions/rotate-auth-secret"
import { saveConfigValues } from "../-functions/save-config-values"
import type { ConfigureField, ConfigureIssue, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"
import { ConfigureActions } from "./configure-actions"

const FIELD_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "General",
    keys: ["app_base_url", "privacy_policy_url", "terms_of_service_url", "chat_auth_secret"],
  },
  {
    title: "Authentication",
    keys: [
      "better_auth_secret",
      "google_client_id",
      "google_client_secret",
      "github_client_id",
      "github_client_secret",
    ],
  },
  {
    title: "Email Delivery",
    keys: [
      "email_provider",
      "email_from_address",
      "resend_api_key",
      "aws_region",
      "aws_access_key_id",
      "aws_secret_access_key",
    ],
  },
  { title: "LLM Providers", keys: ["openai_api_key"] },
]

const ROTATABLE_KEYS = new Set(["better_auth_secret", "chat_auth_secret"])

// The base URL is the origin the operator is already browsing, so the editor offers to fill it in.
const CURRENT_ORIGIN_KEY = "app_base_url"

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

  const fieldsByKey = new Map(fields.map((field) => [field.key, field]))
  const draftFor = (key: string): FieldDraft => drafts[key] ?? { kind: "unchanged" }

  const pendingUpdates = fields.flatMap((field) => {
    const draft = draftFor(field.key)
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

      {setupComplete
        ? (
          <Alert>
            <CheckCircleIcon aria-hidden="true" />
            <AlertTitle>Setup is complete</AlertTitle>
            <AlertDescription>
              Saved changes apply within about ten seconds and reach every server instance.
            </AlertDescription>
          </Alert>
        )
        : (
          <Alert>
            <WarningCircleIcon aria-hidden="true" />
            <AlertTitle>Finish setting up</AlertTitle>
            <AlertDescription>
              {issues.length > 0
                ? (
                  <ul className="list-disc pl-4">
                    {issues.map((issue) => (
                      <li key={`${issue.key}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                )
                : "Everything required is in place; finish setup to open the app."}
            </AlertDescription>
          </Alert>
        )}

      {FIELD_GROUPS.map((group) => {
        const groupFields = group.keys
          .map((key) => fieldsByKey.get(key))
          .filter((field): field is ConfigureField => field !== undefined)
        if (groupFields.length === 0) return null
        return (
          <Card key={group.title}>
            <CardHeader>
              <CardTitle>{group.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              {groupFields.map((field) => (
                <ConfigFieldInput
                  key={field.key}
                  field={field}
                  draft={draftFor(field.key)}
                  error={fieldErrors[field.key]}
                  disabled={busy}
                  onDraftChange={(draft) => setDraft(field.key, draft)}
                  onRotate={ROTATABLE_KEYS.has(field.key)
                    ? () => void handleRotate(field.key)
                    : undefined}
                  footer={field.key === CURRENT_ORIGIN_KEY
                    ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          // Reading location in the handler keeps it out of the server render.
                          onClick={() =>
                            setDraft(field.key, {
                              kind: "set",
                              value: globalThis.location.origin,
                            })}
                        >
                          <GlobeIcon aria-hidden="true" />
                          Use current origin
                        </Button>
                      </div>
                    )
                    : undefined}
                />
              ))}
            </CardContent>
          </Card>
        )
      })}

      {actions}
    </div>
  )
}
