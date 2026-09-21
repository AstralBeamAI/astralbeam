import { createFileRoute } from "@tanstack/react-router"

import themeSchemaText from "@/brand/theme.schema.json?raw"

export const Route = createFileRoute("/schemas/theme.schema.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(themeSchemaText, {
          headers: { "Content-Type": "application/schema+json; charset=utf-8" },
        }),
    },
  },
})
