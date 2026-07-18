import tailwindcss from "@tailwindcss/vite"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, lazyPlugins } from "vite-plus"

export default defineConfig({
  resolve: { tsconfigPaths: true },
  server: { port: 3000 },
  plugins: lazyPlugins(() => [devtools(), nitro(), tailwindcss(), tanstackStart(), viteReact()]),
})
