import process from "node:process"
import tailwindcss from "@tailwindcss/vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  for (const key of [
    "BASIC_AUTH_USERNAME",
    "BASIC_AUTH_PASSWORD",
    "ASTRALBEAM_API_KEY",
    "APP_ORIGIN",
  ]) {
    if (env[key] !== undefined) process.env[key] ??= env[key]
  }
  return {
    resolve: { tsconfigPaths: true },
    server: { port: Number(process.env.PORT ?? 4900), strictPort: true },
    plugins: [tailwindcss(), nitro({ preset: "deno-server" }), tanstackStart(), react()],
  }
})
