import process from "node:process"

import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  // `strictPort` keeps a busy port an error instead of a silent move to the next one, which would
  // leave the browser on a stale server. The end-to-end suite sets PORT to run its own instance.
  server: { port: Number(process.env.PORT ?? 4700), strictPort: true },
  plugins: [nitro(), tanstackStart(), react()],
})
