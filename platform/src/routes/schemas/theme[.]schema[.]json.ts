import { createFileRoute } from "@tanstack/react-router"

import themeSchemaText from "@/theme/theme.schema.json?raw"

// Publishes the schema that `brand.json` names in `$schema`, for editor validation and completion.
export const Route = createFileRoute("/schemas/theme.schema.json")({
  server: {
    handlers: {
      GET: () =>
        new Response(themeSchemaText, {
          headers: {
            "Content-Type": "application/schema+json; charset=utf-8",
            "Cache-Control": "public, no-cache",
          },
        }),
    },
  },
})
