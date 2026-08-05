import react from "@astrojs/react"
import sitemap from "@astrojs/sitemap"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"

export default defineConfig({
  site: "https://www.astralbeam.com",
  integrations: [
    react({
      babel: {
        // Surface every React Compiler diagnostic as a build error.
        // https://react.dev/reference/react-compiler/panicThreshold
        plugins: [["babel-plugin-react-compiler", { panicThreshold: "all_errors" }]],
      },
      // Astro replaces plugin-react's default exclusion with `.astro`; restore `node_modules`.
      // https://github.com/withastro/astro/blob/%40astrojs/react%406.0.1/packages/integrations/react/src/index.ts#L79-L92
      // https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-react#exclude
      exclude: /\/node_modules\//,
    }),
    sitemap(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
})
