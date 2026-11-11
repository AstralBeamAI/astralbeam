import process from "node:process"

import { SANDBOX_PROVIDER_IDS, type SandboxProviderId } from "./schemas.ts"

export function isSandboxProviderEnabled(provider: SandboxProviderId): boolean {
  if (provider === "docker") return process.env.DOCKERSANDBOX_DISABLED !== "true"
  if (provider === "microsandbox") return process.env.MICROSANDBOX_DISABLED !== "true"
  return true
}

export async function getAvailableSandboxProviderIds() {
  const dockerAvailable =
    isSandboxProviderEnabled("docker") &&
    (await import("@astralbeam/sandbox").then((module) => module.DockerSandbox.available()))
  return SANDBOX_PROVIDER_IDS.filter(
    (provider) =>
      isSandboxProviderEnabled(provider) &&
      (provider !== "docker" || dockerAvailable) &&
      (provider !== "microsandbox" || Boolean(process.env.__ASTRALBEAM_INTERNAL_MICROSANDBOX_SDK)),
  )
}
