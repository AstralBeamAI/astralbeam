import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { loadWorkspaceEnvironment } from "@astralbeam/utils/environment"

const packageDirectory = fileURLToPath(new URL("../", import.meta.url))

// The Better Auth CLI imports the server config outside Vite, so load the app's root environment before evaluation. https://www.better-auth.com/docs/concepts/cli
loadWorkspaceEnvironment("development")
const generateResult = spawnSync(
  "vp",
  [
    "dlx",
    "auth@1.7.0-rc.5",
    "generate",
    "--config",
    "../auth/src/auth.ts",
    "--yes",
    "--output",
    "./src/schema/auth.ts",
  ],
  {
    cwd: packageDirectory,
    env: process.env,
    stdio: "inherit",
  },
)

if (generateResult.error) {
  throw generateResult.error
}

if (generateResult.status !== 0) {
  process.exitCode = generateResult.status ?? 1
} else {
  const formatResult = spawnSync("vp", ["fmt", "src/schema/auth.ts"], {
    cwd: packageDirectory,
    stdio: "inherit",
  })

  if (formatResult.error) {
    throw formatResult.error
  }

  process.exitCode = formatResult.status ?? 1
}
