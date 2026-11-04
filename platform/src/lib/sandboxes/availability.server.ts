import process from "node:process"

import { SANDBOX_PROVIDER_IDS } from "./schemas.ts"

export async function getAvailableSandboxProviderIds() {
  const dockerAvailable =
    process.env.DOCKERSANDBOX_DISABLED !== "true" &&
    (await import("@astralbeam/sandbox").then((module) => module.DockerSandbox.available()))
  return SANDBOX_PROVIDER_IDS.filter((provider) => provider !== "docker" || dockerAvailable)
}
