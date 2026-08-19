import { defineConfig } from "vite"

export default defineConfig({
  resolve: {
    // The file:-linked SDK package resolves through its real path, so its wrapper would
    // otherwise pick up React from sdk/node_modules, mixing two React copies and breaking hooks:
    // https://react.dev/warnings/invalid-hook-call-warning
    dedupe: ["react", "react-dom"],
  },
})
