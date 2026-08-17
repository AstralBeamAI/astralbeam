import { fileURLToPath } from "node:url"

import { loadEnv, type Plugin, type UserConfig } from "vite-plus"

const workspaceDirectory = fileURLToPath(new URL("../../../", import.meta.url))

export function loadWorkspaceEnvironment(mode: string) {
  for (const [name, value] of Object.entries(loadEnv(mode, workspaceDirectory, ""))) {
    process.env[name] ??= value
  }
}

function workspaceEnvironmentPlugin(): Plugin {
  return {
    name: "astralbeam:workspace-environment",
    enforce: "pre",
    config(_config, { mode }) {
      // Load before Vite creates its module runners so server packages inherit the root environment. https://vite.dev/guide/api-plugin.html#config
      loadWorkspaceEnvironment(mode)
    },
  }
}

export const workspaceEnvironmentViteConfig = {
  envDir: workspaceDirectory,
  plugins: [workspaceEnvironmentPlugin()],
} satisfies UserConfig
