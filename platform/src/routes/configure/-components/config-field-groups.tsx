"use client"

import { GlobeIcon, WarningIcon } from "@phosphor-icons/react"
import { Fragment } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { EMAIL_PROVIDER_SETTING_KEYS, SMTP_DEFAULTS } from "@/lib/email/schemas"
import type { EmailProvider } from "@/lib/email/schemas"
import type { ConfigIssue, ConfigKey } from "@/lib/config/types"
import type { ConfigureField, FieldDraft } from "../-lib/types"
import { ConfigFieldInput } from "./config-field-input"
import { ConfigSection } from "./config-section"
import { StorageConnectionTest } from "./storage-connection-test"
import type { StorageConnection } from "@/lib/storage/schemas"

const configGroupOrder = [
  "General",
  "Authentication",
  "Email Delivery",
  "File storage",
  "Observability",
] as const

const smtpConnectionPresets = [
  {
    label: "Local",
    ...SMTP_DEFAULTS,
    port: String(SMTP_DEFAULTS.port),
    username: "",
  },
  { label: "Resend", host: "smtp.resend.com", port: "465", security: "tls", username: "resend" },
  {
    label: "Cloudflare",
    host: "smtp.mx.cloudflare.net",
    port: "465",
    security: "tls",
    username: "api_token",
  },
  {
    label: "SES US East (N. Virginia)",
    host: "email-smtp.us-east-1.amazonaws.com",
    port: "465",
    security: "tls",
    username: "",
  },
]

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

const otlpEndpointPresets = [
  { label: "Local", endpoint: "http://127.0.0.1:4318" },
  { label: "PostHog", endpoint: "https://us.i.posthog.com/i" },
  { label: "New Relic", endpoint: "https://otlp.nr-data.net" },
  { label: "Datadog", endpoint: "https://otlp.datadoghq.com" },
  {
    label: "Sentry",
    endpoint: "https://o<organization-id>.ingest.us.sentry.io/api/<project-id>/integration/otlp",
  },
  { label: "Honeycomb", endpoint: "https://api.honeycomb.io" },
]

export function ConfigFieldGroups({
  fields,
  issues,
  changedKeys,
  drafts,
  revealedValues,
  fieldErrors,
  failedSaveAttempt,
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
  storageProvider,
}: {
  fields: ConfigureField[]
  issues: ConfigIssue[]
  changedKeys: Set<string>
  drafts: Record<string, FieldDraft>
  revealedValues: Record<string, string>
  fieldErrors: Record<string, string>
  failedSaveAttempt: number
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
  storageProvider: string
}) {
  const fieldsByGroup = Map.groupBy(fields, (field) => field.group)
  const trustProxy =
    drafts.trust_proxy?.kind === "set"
      ? drafts.trust_proxy.value
      : fields.find((field) => field.key === "trust_proxy")?.value
  const providerKeys = new Set<string>(EMAIL_PROVIDER_SETTING_KEYS[emailProvider])
  const smtpPresetsLocked = fields.some(
    (field) =>
      field.source === "environment" &&
      EMAIL_PROVIDER_SETTING_KEYS.smtp.some((key) => key === field.key),
  )
  const storagePresetsLocked = fields.some(
    (field) =>
      field.source === "environment" &&
      ["s3_endpoint", "s3_region", "s3_path_style"].includes(field.key),
  )
  const changingStorageDestination = [
    "storage_provider",
    "storage_directory",
    "s3_endpoint",
    "s3_region",
    "s3_bucket",
    "s3_path_style",
  ].some((key) => changedKeys.has(key))

  return [...fieldsByGroup]
    .toSorted(
      ([first], [second]) => configGroupOrder.indexOf(first) - configGroupOrder.indexOf(second),
    )
    .map(([group, groupFields]) => {
      const visibleFields = groupFields.filter((field) => {
        if (field.key === "client_ip_headers") return Boolean(trustProxy && trustProxy !== "false")
        if (field.key.startsWith("s3_")) return storageProvider === "s3"
        if (field.key === "storage_directory") return storageProvider === "filesystem"
        return (
          group !== "Email Delivery" ||
          ["email_provider", "email_from_address"].includes(field.key) ||
          providerKeys.has(field.key)
        )
      })
      const configured = !visibleFields.some(
        (field) =>
          issues.some((issue) => issue.key === field.key) ||
          fieldErrors[field.key] ||
          field.storageStatus,
      )
      return (
        <ConfigSection
          key={group}
          title={group}
          documentationHref={`/docs/self-hosting/configuration#${group.toLowerCase().replaceAll(" ", "-")}`}
          summary={summarizeConfigGroup(group, groupFields)}
          configured={configured}
          optional={group === "Observability"}
          hasChanges={groupFields.some((field) => changedKeys.has(field.key))}
          errorAttempt={
            groupFields.some((field) => Boolean(fieldErrors[field.key]))
              ? failedSaveAttempt
              : undefined
          }
        >
          {group === "Observability" && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Optional. Configure an endpoint to export traces. Log export is disabled by default
                and always keeps console JSON. Presets fill the base endpoint only. Add provider
                headers separately and replace any placeholders before saving.
              </p>
              <div className="flex flex-wrap gap-2">
                {otlpEndpointPresets.map((preset) => (
                  <Button
                    key={preset.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      disabled ||
                      groupFields.some(
                        (field) =>
                          field.key === "otel_exporter_otlp_endpoint" &&
                          field.source === "environment",
                      )
                    }
                    onClick={() =>
                      onDraftChange("otel_exporter_otlp_endpoint", {
                        kind: "set",
                        value: preset.endpoint,
                      })
                    }
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {group === "File storage" && storageProvider === "s3" && (
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
          {group === "File storage" && changingStorageDestination && (
            <Alert>
              <WarningIcon aria-hidden="true" className="text-warning" />
              <AlertTitle>Existing files must be migrated manually</AlertTitle>
              <AlertDescription>
                Saving these settings does not move existing attachments, avatars, or logos. Migrate
                the objects to the new destination with their object keys unchanged to keep them
                accessible, then restart other server instances after saving.
              </AlertDescription>
            </Alert>
          )}
          {visibleFields.map((field) => (
            <Fragment key={field.key}>
              <ConfigFieldInput
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
              {field.key === "email_provider" && emailProvider === "smtp" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {smtpConnectionPresets.map((preset) => (
                      <Button
                        key={preset.label}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled || smtpPresetsLocked}
                        onClick={() => {
                          for (const [key, value] of Object.entries({
                            smtp_host: preset.host,
                            smtp_port: preset.port,
                            smtp_security: preset.security,
                            smtp_username: preset.username,
                            smtp_password: "",
                          }))
                            onDraftChange(key, { kind: "set", value })
                        }}
                      >
                        {preset.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {smtpPresetsLocked
                      ? "Connection presets are unavailable while SMTP settings come from the environment."
                      : "Presets fill SMTP settings and clear credentials. For Resend or Cloudflare, enter the API token as the password. For SES, enter SMTP credentials created in us-east-1. Set a verified sender address for hosted services."}
                  </p>
                </div>
              )}
            </Fragment>
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
          {group === "File storage" && storageProvider === "s3" && (
            <StorageConnectionTest settings={storageSettings} disabled={disabled} />
          )}
        </ConfigSection>
      )
    })
}

function summarizeConfigGroup(group: ConfigureField["group"], fields: ConfigureField[]): string {
  const value = (key: ConfigKey) => fields.find((field) => field.key === key)?.value
  const isSet = (key: ConfigKey) =>
    fields.some((field) => field.key === key && field.isSet && field.storageStatus !== "unreadable")

  const provider = value("email_provider") ?? "smtp"
  const parts = {
    General: [value("app_base_url"), value("support_email_address")],
    Authentication: [
      isSet("better_auth_secret") && "Password sign-in",
      isSet("turnstile_site_key") && isSet("turnstile_secret_key") && "Turnstile",
      isSet("google_client_id") && isSet("google_client_secret") && "Google",
      isSet("github_client_id") && isSet("github_client_secret") && "GitHub",
    ],
    "Email Delivery": [
      provider === "smtp" ? "SMTP" : provider === "ses" ? "Amazon SES" : "Resend",
      provider === "smtp"
        ? [value("smtp_host"), value("smtp_port")].filter(Boolean).join(":")
        : provider === "ses" && value("aws_region"),
      value("email_from_address") || (provider === "smtp" && "Default sender"),
    ],
    "File storage":
      value("storage_provider") === "filesystem"
        ? ["File System", value("storage_directory")]
        : ["S3-compatible", value("s3_bucket"), value("s3_region")],
    Observability: [
      value("otel_sdk_disabled") === "true"
        ? "Disabled"
        : value("otel_exporter_otlp_endpoint") || "Disabled",
    ],
  }[group]
  return parts.filter(Boolean).join(" · ") || "Not configured"
}
