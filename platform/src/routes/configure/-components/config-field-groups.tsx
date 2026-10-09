"use client"

import { GlobeIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { EMAIL_PROVIDER_SETTING_KEYS } from "@/lib/email/schemas"
import type { EmailProvider } from "@/lib/email/schemas"
import type { ConfigKey } from "@/lib/config/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"
import { StorageConnectionTest } from "./storage-connection-test"
import type { StorageConnection } from "@/lib/storage/schemas"

const storageConnectionPresets = [
  {
    label: "Local RustFS / MinIO",
    endpoint: "http://127.0.0.1:9000",
    region: "us-east-1",
    pathStyle: "true",
  },
  {
    label: "AWS S3 (us-east-1)",
    endpoint: "https://s3.us-east-1.amazonaws.com",
    region: "us-east-1",
    pathStyle: "false",
  },
  {
    label: "Cloudflare R2",
    endpoint: "https://<account-id>.r2.cloudflarestorage.com",
    region: "auto",
    pathStyle: "true",
  },
]

export function ConfigFieldGroups({
  fields,
  drafts,
  revealedValues,
  fieldErrors,
  disabled,
  onDraftChange,
  onGenerate,
  onReveal,
  onTestEmailProvider,
  emailProvider,
  canTestEmailProvider,
  emailProviderTesting,
  emailProviderTestResult,
  storageSettings,
}: {
  fields: ConfigureField[]
  drafts: Record<string, FieldDraft>
  revealedValues: Record<string, string>
  fieldErrors: Record<string, string>
  disabled: boolean
  onDraftChange: (key: string, draft: FieldDraft) => void
  onGenerate: (key: ConfigKey) => void
  onReveal: (key: ConfigKey) => Promise<boolean>
  onTestEmailProvider: () => void
  emailProvider: EmailProvider
  canTestEmailProvider: boolean
  emailProviderTesting: boolean
  emailProviderTestResult: { ok: boolean; message: string } | undefined
  storageSettings: StorageConnection | undefined
}) {
  const fieldsByGroup = Map.groupBy(fields, (field) => field.group)
  const providerKeys = new Set<string>(EMAIL_PROVIDER_SETTING_KEYS[emailProvider])
  const storagePresetsLocked = fields.some(
    (field) =>
      field.source === "environment" &&
      ["s3_endpoint", "s3_region", "s3_path_style"].includes(field.key),
  )

  return [...fieldsByGroup].map(([group, groupFields]) => {
    const visibleFields =
      group === "Email Delivery"
        ? groupFields.filter(
            (field) =>
              ["email_provider", "email_from_address"].includes(field.key) ||
              providerKeys.has(field.key),
          )
        : groupFields
    return (
      <Card key={group}>
        <CardHeader>
          <CardTitle>{group}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {group === "File storage" && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {storageConnectionPresets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled || storagePresetsLocked}
                    onClick={() => {
                      for (const [key, value] of Object.entries({
                        s3_endpoint: preset.endpoint,
                        s3_region: preset.region,
                        s3_path_style: preset.pathStyle,
                      }))
                        onDraftChange(key, { kind: "set", value })
                    }}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {storagePresetsLocked
                  ? "Connection presets are unavailable while these settings come from the environment."
                  : "Prefill connection settings, then adjust the endpoint and region for your provider. Bucket and credentials stay unchanged. For R2, replace <account-id> with your account ID."}
              </p>
            </div>
          )}
          {visibleFields.map((field) => (
            <ConfigFieldInput
              key={field.key}
              field={field}
              draft={drafts[field.key] ?? { kind: "unchanged" }}
              revealedValue={revealedValues[field.key]}
              error={fieldErrors[field.key]}
              disabled={disabled}
              onDraftChange={(draft) => onDraftChange(field.key, draft)}
              onGenerate={field.canGenerate ? () => onGenerate(field.key) : undefined}
              onReveal={field.kind === "secret" ? () => onReveal(field.key) : undefined}
              footer={
                field.source === "database" && field.key === "app_base_url" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={disabled}
                    // Reading location in the handler keeps it out of the server render.
                    onClick={() =>
                      onDraftChange(field.key, { kind: "set", value: globalThis.location.origin })
                    }
                  >
                    <GlobeIcon aria-hidden="true" />
                    Use current origin
                  </Button>
                ) : undefined
              }
            />
          ))}
          {group === "Email Delivery" && (
            <div className="flex flex-col items-start gap-3 rounded-md border p-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Email provider connection test</p>
                <p className="text-sm text-muted-foreground">
                  {emailProvider === "smtp"
                    ? "Checks the SMTP server, security mode, and optional authentication."
                    : emailProvider === "resend"
                      ? "Checks that Resend accepts the API key, including sending-only keys."
                      : "Checks the AWS region, credentials, SES access, and account sending status. Requires ses:GetAccount permission."}
                  {"  "}Uses the current values without saving them or sending an email.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || !canTestEmailProvider}
                onClick={onTestEmailProvider}
              >
                {emailProviderTesting && <Spinner />}
                {emailProviderTesting ? "Testing connection" : "Test connection"}
              </Button>
              {emailProviderTestResult && (
                <Alert variant={emailProviderTestResult.ok ? "default" : "destructive"}>
                  <AlertTitle>
                    {emailProviderTestResult.ok
                      ? "Email provider connection succeeded"
                      : "Email provider connection failed"}
                  </AlertTitle>
                  <AlertDescription>{emailProviderTestResult.message}</AlertDescription>
                </Alert>
              )}
            </div>
          )}
          {group === "File storage" && (
            <StorageConnectionTest settings={storageSettings} disabled={disabled} />
          )}
        </CardContent>
      </Card>
    )
  })
}
