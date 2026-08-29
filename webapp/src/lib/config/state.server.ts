import { getGlobalConfigState } from "@/lib/config/runtime.server"
import type { ConfigValues, PublicConfig } from "@/lib/types"

export async function isSetupComplete(): Promise<boolean> {
  return (await getGlobalConfigState()).issues.length === 0
}

// API-route gate; page routes redirect to /configure from the root route instead.
export async function setupGateResponse(): Promise<Response | null> {
  if (await isSetupComplete()) return null
  return Response.json(
    { error: "Application is not configured" },
    { status: 503, headers: { "retry-after": "10" } },
  )
}

export async function loadPublicConfig(): Promise<PublicConfig | null> {
  const config = await getGlobalConfigState()
  return config.issues.length === 0 ? publicConfigFromValues(config.values) : null
}

// Derived only from provider-presence booleans and non-secret URLs; structurally secret-free.
export function publicConfigFromValues(values: ConfigValues): PublicConfig {
  if (!values.turnstile_site_key) throw new Error("TURNSTILE_SITE_KEY is required")
  const enabledSocialProviders: PublicConfig["enabledSocialProviders"] = []
  if (values.google_client_id && values.google_client_secret) {
    enabledSocialProviders.push("google")
  }
  if (values.github_client_id && values.github_client_secret) {
    enabledSocialProviders.push("github")
  }
  return {
    enabledSocialProviders,
    turnstileSiteKey: values.turnstile_site_key,
    privacyPolicyUrl: values.privacy_policy_url,
    termsOfServiceUrl: values.terms_of_service_url,
  }
}
