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

Shared light and dark colors come from the explicit `.light` and `.dark` selectors in `@astralbeam/brand/colors.css`, which this package imports before mapping the tokens into Tailwind. Author palette changes in the brand package instead of duplicating color values here.
