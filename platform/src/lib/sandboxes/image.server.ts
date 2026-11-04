import process from "node:process"
import { Schema } from "effect"

import { version } from "@/../package.json" with { type: "json" }
import { SandboxImageSchema } from "./schemas.ts"

export function getLocalSandboxImage(): string {
  return Schema.decodeUnknownSync(SandboxImageSchema)(
    process.env.LOCAL_SANDBOX_IMAGE ?? `ghcr.io/astralbeamai/sandbox:${version}`,
  )
}
