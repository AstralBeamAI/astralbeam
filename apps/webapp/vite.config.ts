import tailwindcss from "@tailwindcss/vite"
import babel from "@rolldown/plugin-babel"
import { devtools } from "@tanstack/devtools-vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact, { reactCompilerPreset } from "@vitejs/plugin-react"
import { nitro } from "nitro/vite"
import { defineConfig, lazyPlugins, mergeConfig } from "vite-plus"
import { sharedViteConfig } from "../../vite.config"

export default defineConfig(({ mode }) =>
  mergeConfig(sharedViteConfig, {
    server: { port: 3000 },
    plugins: lazyPlugins(() => [
      devtools(),
      tanstackStart(),
      // Vitest reads this config in `test` mode; starting Nitro there fails before discovery.
      // https://vitest.dev/guide/#configuring-vitest
      ...(mode === "test" ? [] : [nitro()]),
      viteReact(),
      // Vite 8 runs React Compiler through Babel; fail the build on every compiler diagnostic.
      // https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#react-compiler
      // https://react.dev/reference/react-compiler/panicThreshold
      babel({ presets: [reactCompilerPreset({ panicThreshold: "all_errors" })] }),
      tailwindcss(),
    ]),
  }),
)
