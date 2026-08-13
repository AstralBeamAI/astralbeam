# `@astralbeam/ui`

Shared AstralBeam styles, React components, and utilities.

Import the stylesheet once:

```css
@import "@astralbeam/ui/styles.css";
```

```tsx
import { Button } from "@astralbeam/ui/components/button"
import { cn } from "@astralbeam/ui/lib/utils"
```

Components and utilities are exposed through `@astralbeam/ui/components/*` and `@astralbeam/ui/lib/*`. Consumers provide `react` and `react-dom`.

This package maps semantic CSS variables into Tailwind but does not provide their values. Before rendering shared components, the consuming application must supply `--radius` and every semantic color listed by the [AstralBeam theme schema](https://www.astralbeam.ai/schemas/theme.schema.json).

The application owns theme selection, validation, fallback, and first-paint injection. It must apply exactly one of `.light` or `.dark` to a root or ancestor before rendering this stylesheet's components.
