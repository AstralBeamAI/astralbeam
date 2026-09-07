import type { SandboxProviderOptions } from "@/lib/sandbox/schemas"

export const SANDBOX_PROVIDER_OPTION_DEFAULTS: SandboxProviderOptions = {
  daytona: { target: "us", snapshot: "daytona-medium" },
  docker: { image: "node:22" },
  sprites: {},
  vercel: { teamId: "", projectId: "", runtime: "node24" },
}
