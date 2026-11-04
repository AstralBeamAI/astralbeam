import type { SandboxProviderOptions } from "@/lib/sandboxes/schemas"

export const SANDBOX_PROVIDER_OPTION_DEFAULTS: SandboxProviderOptions = {
  daytona: { target: "us", snapshot: "daytona-medium" },
  docker: {},
  e2b: { template: "base" },
  microsandbox: {},
  sprites: {},
  vercel: { teamId: "", projectId: "", runtime: "node24" },
}
