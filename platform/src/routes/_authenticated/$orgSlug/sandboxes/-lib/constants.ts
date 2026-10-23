import type { SandboxProviderOptions } from "@/lib/sandboxes/schemas"

export const SANDBOX_PROVIDER_OPTION_DEFAULTS: SandboxProviderOptions = {
  daytona: { target: "us", snapshot: "daytona-medium" },
  docker: { image: "node:22" },
  e2b: { template: "base" },
  sprites: {},
  vercel: { teamId: "", projectId: "", runtime: "node24" },
}
