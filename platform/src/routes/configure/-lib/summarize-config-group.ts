import type { ConfigDefinition, ConfigKey } from "@/lib/config/types"
import type { ConfigureField } from "./types"

export function summarizeConfigGroup(
  group: ConfigDefinition["group"],
  fields: ConfigureField[],
): string {
  const value = (key: ConfigKey) => fields.find((field) => field.key === key)?.value
  const isSet = (key: ConfigKey) =>
    fields.some((field) => field.key === key && field.isSet && field.storageStatus !== "unreadable")

  switch (group) {
    case "General":
      return (
        [value("app_base_url"), value("support_email_address")].filter(Boolean).join(" · ") ||
        "Set the application URL and support email."
      )
    case "File storage":
      return (
        [value("s3_bucket"), value("s3_region")].filter(Boolean).join(" · ") ||
        "Connect a private S3-compatible bucket."
      )
    case "Authentication":
      return (
        [
          isSet("better_auth_secret") && "Password sign-in",
          isSet("turnstile_site_key") && isSet("turnstile_secret_key") && "Turnstile",
          isSet("google_client_id") && isSet("google_client_secret") && "Google",
          isSet("github_client_id") && isSet("github_client_secret") && "GitHub",
        ]
          .filter(Boolean)
          .join(" · ") || "Set up session security and sign-in protection."
      )
    case "Email Delivery": {
      const provider = value("email_provider") ?? "smtp"
      const destination =
        provider === "smtp"
          ? [value("smtp_host"), value("smtp_port")].filter(Boolean).join(":")
          : provider === "ses"
            ? value("aws_region")
            : null
      return [
        provider === "smtp" ? "SMTP" : provider === "ses" ? "Amazon SES" : "Resend",
        destination,
        value("email_from_address") || "Default sender",
      ]
        .filter(Boolean)
        .join(" · ")
    }
  }
}
