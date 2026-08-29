"use client"

import { GlobeIcon } from "@phosphor-icons/react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"
import { EMAIL_PROVIDER_SETTING_KEYS } from "@/emails/schema"
import type { EmailProvider } from "@/emails/schema"
import type { ConfigKey } from "@/lib/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"

export function ConfigFieldGroups({
  fields,
  drafts,
  fieldErrors,
  disabled,
  onDraftChange,
  onGenerate,
  onTestEmailProvider,
  emailProvider,
  canTestEmailProvider,
  emailProviderTesting,
  emailProviderTestResult,
}: {
  fields: ConfigureField[]
  drafts: Record<string, FieldDraft>
  fieldErrors: Record<string, string>
  disabled: boolean
  onDraftChange: (key: string, draft: FieldDraft) => void
  onGenerate: (key: ConfigKey) => void
  onTestEmailProvider: () => void
  emailProvider: EmailProvider
  canTestEmailProvider: boolean
  emailProviderTesting: boolean
  emailProviderTestResult: { ok: boolean; message: string } | undefined
}) {
  const fieldsByGroup = Map.groupBy(fields, (field) => field.group)
  const providerKeys = new Set<string>(EMAIL_PROVIDER_SETTING_KEYS[emailProvider])

  return [...fieldsByGroup].map(([group, groupFields]) => {
    const visibleFields = group === "Email Delivery"
      ? groupFields.filter((field) =>
        ["email_provider", "email_from_address"].includes(field.key) ||
        providerKeys.has(field.key)
      )
      : groupFields
    return (
      <Card key={group}>
        <CardHeader>
          <CardTitle>{group}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {visibleFields.map((field) => (
            <ConfigFieldInput
              key={field.key}
              field={field}
              draft={drafts[field.key] ?? { kind: "unchanged" }}
              error={fieldErrors[field.key]}
              disabled={disabled}
              onDraftChange={(draft) => onDraftChange(field.key, draft)}
              onGenerate={field.canGenerate ? () => onGenerate(field.key) : undefined}
              footer={field.source === "database" && field.key === "app_base_url"
                ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    disabled={disabled}
                    // Reading location in the handler keeps it out of the server render.
                    onClick={() =>
                      onDraftChange(field.key, { kind: "set", value: globalThis.location.origin })}
                  >
                    <GlobeIcon aria-hidden="true" />
                    Use current origin
                  </Button>
                )
                : undefined}
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
        </CardContent>
      </Card>
    )
  })
}
