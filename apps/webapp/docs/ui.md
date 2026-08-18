# Webapp UI

AstralBeam styles, React components, and utilities live directly in the webapp.

```tsx
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
```

The application imports `apps/webapp/src/styles.css` once. Shadcn-generated components live under `apps/webapp/src/components/ui`, application components live under `apps/webapp/src/components`, and utilities live under `apps/webapp/src/lib`.

The stylesheet maps semantic CSS variables into Tailwind but does not provide their values. Before rendering components, the application must supply `--radius` and every semantic color listed by the [AstralBeam theme schema](https://www.astralbeam.ai/schemas/theme.schema.json).

The application owns theme selection, validation, fallback, and first-paint injection. It must apply exactly one of `.light` or `.dark` to a root or ancestor before rendering this stylesheet's components.
