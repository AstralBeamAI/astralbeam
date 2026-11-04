import type { SandboxProviderOptions } from "@/lib/sandboxes/schemas"
import { version } from "@/../package.json" with { type: "json" }

export const SANDBOX_PROVIDER_OPTION_DEFAULTS: SandboxProviderOptions = {
  daytona: { target: "us", snapshot: "daytona-medium" },
  docker: { image: `ghcr.io/astralbeamai/sandbox:${version}` },
  e2b: { template: "base" },
  microsandbox: { image: "python:3.13-slim" },
  sprites: {},
  vercel: { teamId: "", projectId: "", runtime: "node24" },
}
