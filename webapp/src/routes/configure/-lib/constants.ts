/** Registry keys laid out in the order the editor shows them, grouped into one card each. */
export const CONFIG_FIELD_GROUPS: { title: string; keys: string[] }[] = [
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
      "turnstile_site_key",
      "turnstile_secret_key",
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

export const ROTATABLE_CONFIG_KEYS = new Set(["better_auth_secret", "chat_auth_secret"])

// The base URL is the origin the operator is already browsing, so the editor offers to fill it in.
export const APP_BASE_URL_CONFIG_KEY = "app_base_url"
